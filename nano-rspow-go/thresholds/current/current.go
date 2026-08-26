// Package current contains Nano mainnet threshold presets for new blocks.
package current

const (
	// Send is the current minimum threshold for send and change blocks.
	Send uint64 = 0xfffffff800000000
	// Receive is the current minimum threshold for receive, open, and epoch blocks.
	Receive uint64 = 0xfffffe0000000000
)
