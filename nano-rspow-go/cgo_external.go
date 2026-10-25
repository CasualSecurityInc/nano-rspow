//go:build nano_rspow_external

package nanorspow

/*
#cgo darwin LDFLAGS: -framework Metal -framework QuartzCore -framework CoreGraphics -framework IOKit -framework Foundation
#cgo linux LDFLAGS: -ldl -lm -lpthread
*/
import "C"
