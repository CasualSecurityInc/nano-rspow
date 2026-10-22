//go:build !linux && !darwin

package nanorspow

/*
#cgo LDFLAGS: -L${SRCDIR}/../target/debug -lnano_rspow_ffi
*/
import "C"
