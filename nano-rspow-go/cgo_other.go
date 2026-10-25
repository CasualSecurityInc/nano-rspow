//go:build !linux && !darwin && !nano_rspow_external

package nanorspow

/*
#cgo LDFLAGS: -L${SRCDIR}/../target/debug -lnano_rspow_ffi
*/
import "C"
