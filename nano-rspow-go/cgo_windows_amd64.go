//go:build windows && amd64

package nanorspow

/*
#cgo LDFLAGS: ${SRCDIR}/native/windows_amd64/libnano_rspow_ffi.a -lkernel32 -lntdll -luserenv -lws2_32 -ldbghelp
*/
import "C"
