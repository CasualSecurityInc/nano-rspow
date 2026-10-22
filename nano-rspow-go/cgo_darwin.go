//go:build darwin

package nanorspow

/*
#cgo LDFLAGS: ${SRCDIR}/../target/debug/libnano_rspow_ffi.a
#cgo LDFLAGS: -framework Metal -framework QuartzCore -framework CoreGraphics -framework IOKit -framework Foundation
*/
import "C"
