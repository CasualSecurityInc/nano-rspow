// Package nanorspow provides typed Go access to the native nano-rspow engine.
//
// The accelerated implementation requires CGO and a native nano-rspow-ffi
// library. Rust owns all GPU state and worker threads; Go passes only copied
// fixed-size values across the ABI. See README.md for build and distribution
// requirements.
package nanorspow

/*
#cgo CFLAGS: -I${SRCDIR}/../nano-rspow-ffi/include
#cgo LDFLAGS: -L${SRCDIR}/../target/debug -lnano_rspow_ffi
#cgo linux LDFLAGS: -ldl -lm -lpthread
#cgo darwin LDFLAGS: -framework Metal -framework QuartzCore -framework CoreGraphics -framework IOKit -framework Foundation
#include "nano_rspow_ffi.h"
*/
import "C"

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"unsafe"

	"github.com/CasualSecurityInc/nano-rspow/nano-rspow-go/thresholds/current"
)

const nativeABIVersion = 1

// Backend controls native generator selection. Auto always retains CPU
// fallback; GPU is an opportunistic runtime accelerator.
type Backend uint32

const (
	BackendAuto Backend = C.NANO_RSPOW_BACKEND_AUTO
	BackendCPU  Backend = C.NANO_RSPOW_BACKEND_CPU
	BackendWGPU Backend = C.NANO_RSPOW_BACKEND_WGPU
)

// WorkType selects a current Nano mainnet threshold preset.
type WorkType uint8

const (
	WorkSend WorkType = iota
	WorkReceive
)

func (w WorkType) Threshold() (uint64, error) {
	switch w {
	case WorkSend:
		return current.Send, nil
	case WorkReceive:
		return current.Receive, nil
	default:
		return 0, fmt.Errorf("nano-rspow: unknown work type %d", w)
	}
}

// ErrCancelled identifies a generation cancelled by the caller or context.
var ErrCancelled = errors.New("nano-rspow: work generation cancelled")

// Status is the stable numeric status returned by the Rust ABI.
type Status uint32

const (
	StatusOK                 Status = C.NANO_RSPOW_OK
	StatusInvalidArgument    Status = C.NANO_RSPOW_INVALID_ARGUMENT
	StatusNullPointer        Status = C.NANO_RSPOW_NULL_POINTER
	StatusAllocationFailure  Status = C.NANO_RSPOW_ALLOCATION_FAILURE
	StatusGenerationFailed   Status = C.NANO_RSPOW_GENERATION_FAILED
	StatusCancelled          Status = C.NANO_RSPOW_CANCELLED
	StatusBackendUnavailable Status = C.NANO_RSPOW_BACKEND_UNAVAILABLE
	StatusBufferTooSmall     Status = C.NANO_RSPOW_BUFFER_TOO_SMALL
	StatusPanic              Status = C.NANO_RSPOW_PANIC
)

// StatusError preserves the explicit native status for callers that need to
// distinguish backend, input, and cancellation failures.
type StatusError struct {
	Status  Status
	Message string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("nano-rspow: %s (status %d)", e.Message, e.Status)
}

func (e *StatusError) Is(target error) bool {
	return target == ErrCancelled && e.Status == StatusCancelled
}

func nativeError(status C.nano_rspow_status) error {
	if status == C.NANO_RSPOW_OK {
		return nil
	}
	code := Status(status)
	if code == StatusCancelled {
		return ErrCancelled
	}
	return &StatusError{Status: code, Message: C.GoString(C.nano_rspow_status_message(status))}
}

// WorkResult is the native result of generation or validation.
type WorkResult struct {
	Nonce      uint64
	Difficulty uint64
	Threshold  uint64
	Valid      bool
}

func resultFromNative(result C.nano_rspow_work_result) WorkResult {
	return WorkResult{
		Nonce:      uint64(result.nonce),
		Difficulty: uint64(result.difficulty),
		Threshold:  uint64(result.threshold),
		Valid:      result.is_valid != 0,
	}
}

// Diagnostics describes the selected backend and, when available, its GPU.
type Diagnostics struct {
	Backend                          string
	BackendAPI                       string
	AdapterName                      string
	DriverInfo                       string
	GPU                              bool
	VendorID                         uint32
	DeviceID                         uint32
	MaxComputeWorkgroupsPerDimension uint32
	DispatchX                        uint32
	NoncesPerDispatch                uint64
	TuningSource                     uint8
}

func nativeString(bytes []C.uint8_t) string {
	data := make([]byte, 0, len(bytes))
	for _, value := range bytes {
		if value == 0 {
			break
		}
		data = append(data, byte(value))
	}
	return string(data)
}

// Generator owns a Rust WorkGenerator. A Generator is safe for concurrent
// use. Close waits for in-flight calls and is idempotent.
type Generator struct {
	mu     sync.RWMutex
	ptr    *C.nano_rspow_generator
	closed bool
}

// NewGenerator creates an engine with the requested backend policy.
func NewGenerator(backend Backend) (*Generator, error) {
	if C.nano_rspow_abi_version() != nativeABIVersion {
		return nil, fmt.Errorf("nano-rspow: unsupported native ABI version %d", C.nano_rspow_abi_version())
	}
	var ptr *C.nano_rspow_generator
	if err := nativeError(C.nano_rspow_generator_new(C.uint32_t(backend), &ptr)); err != nil {
		return nil, err
	}
	generator := &Generator{ptr: ptr}
	runtime.SetFinalizer(generator, func(value *Generator) { _ = value.Close() })
	return generator, nil
}

func (g *Generator) nativePtr() (*C.nano_rspow_generator, error) {
	if g == nil {
		return nil, errors.New("nano-rspow: nil generator")
	}
	if g.ptr == nil || g.closed {
		return nil, errors.New("nano-rspow: generator is closed")
	}
	return g.ptr, nil
}

// Close releases the Rust generator and all associated GPU/thread resources.
func (g *Generator) Close() error {
	if g == nil {
		return nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	runtime.SetFinalizer(g, nil)
	if g.ptr != nil {
		C.nano_rspow_generator_free(g.ptr)
		g.ptr = nil
	}
	g.closed = true
	return nil
}

// Generate searches for valid work. Cancellation is cooperative: cancelling
// ctx signals Rust and the call returns once the active backend observes it.
func (g *Generator) Generate(ctx context.Context, hash [32]byte, threshold uint64) (WorkResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	ptr, err := g.nativePtr()
	if err != nil {
		return WorkResult{}, err
	}
	var request *C.nano_rspow_request
	if err := nativeError(C.nano_rspow_request_new(&request)); err != nil {
		return WorkResult{}, err
	}
	defer C.nano_rspow_request_free(request)

	var output C.nano_rspow_work_result
	finished := make(chan C.nano_rspow_status, 1)
	go func() {
		// hash is copied by Rust before it returns; it is never retained.
		finished <- C.nano_rspow_generator_generate(ptr, (*C.uint8_t)(unsafe.Pointer(&hash[0])), C.uint64_t(threshold), request, &output)
	}()

	select {
	case status := <-finished:
		if err := nativeError(status); err != nil {
			return WorkResult{}, err
		}
		return resultFromNative(output), nil
	case <-ctx.Done():
		_ = C.nano_rspow_request_cancel(request)
		<-finished
		return WorkResult{}, fmt.Errorf("%w: %v", ErrCancelled, ctx.Err())
	}
}

// GenerateType is Generate with a current Nano mainnet threshold preset.
func (g *Generator) GenerateType(ctx context.Context, hash [32]byte, workType WorkType) (WorkResult, error) {
	threshold, err := workType.Threshold()
	if err != nil {
		return WorkResult{}, err
	}
	return g.Generate(ctx, hash, threshold)
}

// Validate computes and checks a nonce without running a search.
func (g *Generator) Validate(hash [32]byte, nonce, threshold uint64) (WorkResult, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	ptr, err := g.nativePtr()
	if err != nil {
		return WorkResult{}, err
	}
	var output C.nano_rspow_work_result
	status := C.nano_rspow_generator_validate(ptr, (*C.uint8_t)(unsafe.Pointer(&hash[0])), C.uint64_t(nonce), C.uint64_t(threshold), &output)
	if err := nativeError(status); err != nil {
		return WorkResult{}, err
	}
	return resultFromNative(output), nil
}

// BackendName returns the selected backend (currently "cpu" or "wgpu").
func (g *Generator) BackendName() (string, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	ptr, err := g.nativePtr()
	if err != nil {
		return "", err
	}
	var output [32]C.uint8_t
	var required C.size_t
	status := C.nano_rspow_generator_backend_name(ptr, &output[0], C.size_t(len(output)), &required)
	if err := nativeError(status); err != nil {
		return "", err
	}
	return nativeString(output[:required]), nil
}

// Diagnostics returns a snapshot of backend and adapter information.
func (g *Generator) Diagnostics() (Diagnostics, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	ptr, err := g.nativePtr()
	if err != nil {
		return Diagnostics{}, err
	}
	var output C.nano_rspow_diagnostics
	if err := nativeError(C.nano_rspow_generator_diagnostics(ptr, &output)); err != nil {
		return Diagnostics{}, err
	}
	return Diagnostics{
		Backend:                          nativeString(output.backend[:]),
		BackendAPI:                       nativeString(output.backend_api[:]),
		AdapterName:                      nativeString(output.adapter_name[:]),
		DriverInfo:                       nativeString(output.driver_info[:]),
		GPU:                              output.has_gpu != 0,
		VendorID:                         uint32(output.vendor_id),
		DeviceID:                         uint32(output.device_id),
		MaxComputeWorkgroupsPerDimension: uint32(output.max_compute_workgroups_per_dimension),
		DispatchX:                        uint32(output.dispatch_x),
		NoncesPerDispatch:                uint64(output.nonces_per_dispatch),
		TuningSource:                     uint8(output.tuning_source),
	}, nil
}
