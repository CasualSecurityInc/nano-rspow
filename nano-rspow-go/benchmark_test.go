package nanorspow

import (
	"context"
	"testing"

	testingthresholds "github.com/CasualSecurityInc/nano-rspow/nano-rspow-go/thresholds/testing"
)

// BenchmarkCGOABI measures a trivial ABI query without a PoW search.
func BenchmarkCGOABI(b *testing.B) {
	for b.Loop() {
		if nativeABI() != nativeABIVersion {
			b.Fatal("native ABI mismatch")
		}
	}
}

// BenchmarkGenerateCPU measures native generation separately from cgo overhead.
func BenchmarkGenerateCPU(b *testing.B) {
	generator, err := NewGenerator(BackendCPU)
	if err != nil {
		b.Fatal(err)
	}
	defer generator.Close()
	ctx := context.Background()
	for b.Loop() {
		result, err := generator.Generate(ctx, knownHash, testingthresholds.Dev)
		if err != nil {
			b.Fatal(err)
		}
		if !result.Valid {
			b.Fatal("generated invalid work")
		}
	}
}
