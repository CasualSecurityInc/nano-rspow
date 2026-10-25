//go:build linux && amd64

package nanorspow

/*
#cgo LDFLAGS: ${SRCDIR}/native/linux_amd64/libnano_rspow_ffi.a -ldl -lgcc_s -lutil -lrt -lpthread -lm -ldl -lc
*/
import "C"
