package util

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

// The gateway (KrakenD) validates the RS256 JWT on the private endpoints
// before proxying, so an Authorization header arriving here is already
// verified — we only decode the payload for owner attribution.
func OwnerFromAuthorization(header string) string {
	parts := strings.SplitN(header, ".", 3)
	if len(parts) < 2 {
		return "anonymous"
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "anonymous"
	}
	var claims struct {
		PreferredUsername string `json:"preferred_username"`
		Sub               string `json:"sub"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return "anonymous"
	}
	if claims.PreferredUsername != "" {
		return claims.PreferredUsername
	}
	if claims.Sub != "" {
		return claims.Sub
	}
	return "anonymous"
}
