package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	ws "github.com/kandev/kandev/pkg/websocket"
)

func TestAgentStdinRequest_AppendSubmit_RoundTrips(t *testing.T) {
	// The buffered composer relies on the backend reading append_submit from
	// the WS payload so the agent's SubmitSequence is appended server-side.
	// If the field is dropped from the struct (e.g. accidental rename) the
	// flush behaves like raw typing and the agent never sees a submitted line.
	raw := []byte(`{"session_id":"s","data":"hi","append_submit":true}`)
	var req AgentStdinRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !req.AppendSubmit {
		t.Errorf("AppendSubmit: got %v, want true", req.AppendSubmit)
	}
	if req.Data != "hi" {
		t.Errorf("Data: got %q, want %q", req.Data, "hi")
	}
}

func TestAgentStdinRequest_AppendSubmit_DefaultsFalse(t *testing.T) {
	raw := []byte(`{"session_id":"s","data":"hi"}`)
	var req AgentStdinRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if req.AppendSubmit {
		t.Errorf("AppendSubmit: got true, want false (default)")
	}
}

func TestWsAgentStdin_InvalidPayload(t *testing.T) {
	log := newTestLogger()
	h := NewPassthroughHandlers(nil, log)

	msg := &ws.Message{
		ID:      "test-1",
		Action:  ws.ActionAgentStdin,
		Payload: json.RawMessage(`{invalid`),
	}
	if _, err := h.wsAgentStdin(context.Background(), msg); err == nil {
		t.Error("expected error for invalid payload")
	}
}

func TestWsAgentStdin_MissingSessionID(t *testing.T) {
	log := newTestLogger()
	h := NewPassthroughHandlers(nil, log)

	msg, _ := ws.NewRequest("test-1", ws.ActionAgentStdin, AgentStdinRequest{Data: "x"})
	_, err := h.wsAgentStdin(context.Background(), msg)
	if err == nil {
		t.Fatal("expected error for missing session_id")
	}
	if !strings.Contains(err.Error(), "session_id is required") {
		t.Errorf("got %q, want substring 'session_id is required'", err.Error())
	}
}

func TestWsAgentStdin_NoExecution(t *testing.T) {
	log := newTestLogger()
	mgr := newTestManager()
	h := NewPassthroughHandlers(mgr, log)

	msg, _ := ws.NewRequest("test-1", ws.ActionAgentStdin, AgentStdinRequest{SessionID: "nope", Data: "x", AppendSubmit: true})
	_, err := h.wsAgentStdin(context.Background(), msg)
	if err == nil {
		t.Fatal("expected error for unknown session")
	}
	if !strings.Contains(err.Error(), "no agent running for session") {
		t.Errorf("got %q, want substring 'no agent running for session'", err.Error())
	}
}
