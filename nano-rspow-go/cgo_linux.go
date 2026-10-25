//go:build linux && !nano_rspow_external

package nanorspow

/*
#cgo LDFLAGS: ${SRCDIR}/../target/debug/libnano_rspow_ffi.a
#cgo LDFLAGS: -ldl -lm -lpthread
*/
import "C"
