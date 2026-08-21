package nanorspow

import (
	"context"
	"errors"
	"testing"
)

var knownHash = [32]byte{
	0x71, 0x8c, 0xc2, 0x12, 0x1c, 0x3e, 0x64, 0x10,
	0x59, 0xbc, 0x1c, 0x2c, 0xfc, 0x45, 0x66, 0x6c,
	0x99, 0xe8, 0xae, 0x92, 0x2f, 0x7a, 0x80, 0x7b,
	0x7d, 0x07, 0x0b, 0x62, 0xc9, 0x95, 0xd7, 0x9e,
}

func TestKnownVectorValidation(t *testing.T) {
	generator, err := NewGenerator(BackendCPU)
	if err != nil {
		t.Fatal(err)
	}
	defer generator.Close()
	result, err := generator.Validate(knownHash, 0x2bf29ef00786a6bc, LegacyEpoch1)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Valid || result.Difficulty != 0xffffffd21c3933f4 {
		t.Fatalf("unexpected known vector result: %+v", result)
	}
}

func TestDevGenerationAndValidation(t *testing.T) {
	generator, err := NewGenerator(BackendCPU)
	if err != nil {
		t.Fatal(err)
	}
	defer generator.Close()
	result, err := generator.GenerateType(context.Background(), knownHash, WorkDev)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Valid {
		t.Fatalf("generated result is invalid: %+v", result)
	}
	validated, err := generator.Validate(knownHash, result.Nonce, Dev)
	if err != nil {
		t.Fatal(err)
	}
	if !validated.Valid {
		t.Fatalf("generated nonce failed validation: %+v", validated)
	}
}

func TestCancellation(t *testing.T) {
	generator, err := NewGenerator(BackendCPU)
	if err != nil {
		t.Fatal(err)
	}
	defer generator.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = generator.Generate(ctx, knownHash, ^uint64(0))
	if !errors.Is(err, ErrCancelled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestDiagnostics(t *testing.T) {
	generator, err := NewGenerator(BackendCPU)
	if err != nil {
		t.Fatal(err)
	}
	defer generator.Close()
	name, err := generator.BackendName()
	if err != nil || name != "cpu" {
		t.Fatalf("unexpected backend name %q: %v", name, err)
	}
	diagnostics, err := generator.Diagnostics()
	if err != nil {
		t.Fatal(err)
	}
	if diagnostics.Backend != "cpu" || diagnostics.GPU {
		t.Fatalf("unexpected diagnostics: %+v", diagnostics)
	}
}
