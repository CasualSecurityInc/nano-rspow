//go:build darwin && amd64

package nanorspow

/*
#cgo LDFLAGS: ${SRCDIR}/native/darwin_amd64/libnano_rspow_ffi.a -lSystem -framework QuartzCore -framework Metal -framework Foundation -framework CoreFoundation -lobjc -framework Foundation -liconv -lSystem -lc -lm
*/
import "C"
