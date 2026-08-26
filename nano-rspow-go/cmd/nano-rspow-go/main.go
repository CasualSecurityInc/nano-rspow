package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	nanorspow "github.com/CasualSecurityInc/nano-rspow/nano-rspow-go"
	"github.com/CasualSecurityInc/nano-rspow/nano-rspow-go/thresholds/current"
)

const helpText = `nano-rspow-go generates Nano proof of work from stdin.

Usage:
  nano-rspow-go [--help]

With no arguments, read one request per line and write one result per line.
Empty lines are ignored. The only accepted argument is --help.

Input:
  <hash_hex>
  <hash_hex>:<threshold_hex>

The optional threshold must use a 0x prefix. Without one, the current
send/change threshold is used.

Output:
  <hash_hex>:0x<threshold_hex>:<work_hex>
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, input io.Reader, output, errors io.Writer) int {
	if len(args) == 1 && args[0] == "--help" {
		_, _ = io.WriteString(output, helpText)
		return 0
	}
	if len(args) != 0 {
		_, _ = fmt.Fprintln(errors, "error: only --help is supported")
		_, _ = io.WriteString(errors, helpText)
		return 2
	}

	generator, err := nanorspow.NewGenerator(nanorspow.BackendAuto)
	if err != nil {
		_, _ = fmt.Fprintf(errors, "error: initialize generator: %v\n", err)
		return 1
	}
	defer generator.Close()

	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 1024), 64*1024)
	writer := bufio.NewWriter(output)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		hashText, hash, threshold, err := parseRequest(line)
		if err != nil {
			_, _ = fmt.Fprintf(errors, "Error parsing request %q: %v\n", line, err)
			continue
		}

		result, err := generator.Generate(context.Background(), hash, threshold)
		if err != nil {
			_, _ = fmt.Fprintf(errors, "Error generating work for %s: %v\n", hashText, err)
			continue
		}

		if _, err := fmt.Fprintf(writer, "%s:0x%016x:%016x\n", hashText, threshold, result.Nonce); err != nil {
			_, _ = fmt.Fprintf(errors, "error: write result: %v\n", err)
			return 1
		}
		if err := writer.Flush(); err != nil {
			_, _ = fmt.Fprintf(errors, "error: flush result: %v\n", err)
			return 1
		}
	}
	if err := scanner.Err(); err != nil {
		_, _ = fmt.Fprintf(errors, "error: read input: %v\n", err)
		return 1
	}
	return 0
}

func parseRequest(line string) (string, [32]byte, uint64, error) {
	var zeroHash [32]byte
	parts := strings.Split(line, ":")
	if len(parts) > 2 {
		return "", zeroHash, 0, fmt.Errorf("request must be <hash_hex> or <hash_hex>:<threshold_hex>")
	}

	hashText := strings.TrimSpace(parts[0])
	hash, err := parseHash(hashText)
	if err != nil {
		return "", zeroHash, 0, err
	}

	threshold := current.Send
	if len(parts) == 2 {
		thresholdText := strings.TrimSpace(parts[1])
		if !strings.HasPrefix(thresholdText, "0x") {
			return "", zeroHash, 0, fmt.Errorf("threshold %q must start with 0x", thresholdText)
		}
		threshold, err = parseHex(thresholdText[2:])
		if err != nil {
			return "", zeroHash, 0, fmt.Errorf("invalid threshold %q: %w", thresholdText, err)
		}
	}
	return hashText, hash, threshold, nil
}

func parseHash(value string) ([32]byte, error) {
	var hash [32]byte
	value = strings.TrimPrefix(value, "0x")
	decoded, err := hex.DecodeString(value)
	if err != nil {
		return hash, fmt.Errorf("invalid hash: %w", err)
	}
	if len(decoded) != len(hash) {
		return hash, fmt.Errorf("hash must be exactly 32 bytes (64 hex chars)")
	}
	copy(hash[:], decoded)
	return hash, nil
}

func parseHex(value string) (uint64, error) {
	return strconv.ParseUint(value, 16, 64)
}
