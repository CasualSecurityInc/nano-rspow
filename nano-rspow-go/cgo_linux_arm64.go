//go:build linux && arm64

package nanorspow

/*
#cgo LDFLAGS: ${SRCDIR}/native/linux_arm64/libnano_rspow_ffi.a -ldl -lgcc_s -lutil -lrt -lpthread -lm -ldl -lc
*/
import "C"
