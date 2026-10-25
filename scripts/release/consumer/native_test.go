package consumer

import (
	"context"
	"encoding/hex"
	"testing"

	nanorspow "github.com/CasualSecurityInc/nano-rspow/nano-rspow-go"
	"github.com/CasualSecurityInc/nano-rspow/nano-rspow-go/thresholds/legacy"
	testingthresholds "github.com/CasualSecurityInc/nano-rspow/nano-rspow-go/thresholds/testing"
)

func TestPublishedNativeModule(t *testing.T) {
	bytes, err := hex.DecodeString("718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2")
	if err != nil {
		t.Fatal(err)
	}
	var root [32]byte
	copy(root[:], bytes)
	generator, err := nanorspow.NewGenerator(nanorspow.BackendCPU)
	if err != nil {
		t.Fatal(err)
	}
	defer generator.Close()
	known, err := generator.Validate(root, 0x2bf29ef00786a6bc, legacy.Epoch1)
	if err != nil || !known.Valid || known.Difficulty != 0xffffffd21c3933f4 {
		t.Fatalf("known vector: %+v, %v", known, err)
	}
	work, err := generator.Generate(context.Background(), root, testingthresholds.Dev)
	if err != nil || !work.Valid {
		t.Fatalf("generation: %+v, %v", work, err)
	}
	checked, err := generator.Validate(root, work.Nonce, testingthresholds.Dev)
	if err != nil || !checked.Valid {
		t.Fatalf("generated work validation: %+v, %v", checked, err)
	}
}
