package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	jwtmiddleware "github.com/auth0/go-jwt-middleware/v2"
	"github.com/auth0/go-jwt-middleware/v2/jwks"
	"github.com/auth0/go-jwt-middleware/v2/validator"
)

// CustomClaims models the private claims we read off the access token.
type CustomClaims struct {
	Scope string `json:"scope"`
}

// Validate satisfies the validator.CustomClaims interface. There is nothing
// extra to check beyond the registered claims, so it always succeeds.
func (c CustomClaims) Validate(ctx context.Context) error { return nil }

// HasScope reports whether the validated token carries the given scope.
func (c CustomClaims) HasScope(expected string) bool {
	for _, s := range strings.Split(c.Scope, " ") {
		if s == expected {
			return true
		}
	}
	return false
}

func main() {
	issuerURL, err := url.Parse("https://" + os.Getenv("AUTH0_DOMAIN") + "/")
	if err != nil {
		log.Fatalf("failed to parse the issuer url: %v", err)
	}

	provider := jwks.NewCachingProvider(issuerURL, 5*time.Minute)

	jwtValidator, err := validator.New(
		provider.KeyFunc,
		validator.RS256,
		issuerURL.String(),
		[]string{os.Getenv("AUTH0_AUDIENCE")},
		validator.WithCustomClaims(func() validator.CustomClaims {
			return &CustomClaims{}
		}),
	)
	if err != nil {
		log.Fatalf("failed to set up the jwt validator: %v", err)
	}

	middleware := jwtmiddleware.New(jwtValidator.ValidateToken)

	mux := http.NewServeMux()

	// GET /api/balance — requires the read:balance scope.
	mux.Handle("/api/balance", middleware.CheckJWT(requireScope("read:balance", http.HandlerFunc(balanceHandler))))

	// POST /api/transfers — requires the write:transfers scope.
	mux.Handle("/api/transfers", middleware.CheckJWT(requireScope("write:transfers", http.HandlerFunc(transferHandler))))

	log.Println("Listening on http://localhost:3001")
	log.Fatal(http.ListenAndServe(":3001", mux))
}

// requireScope rejects the request with 403 insufficient_scope unless the
// validated token carries the given scope.
func requireScope(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(jwtmiddleware.ContextKey{}).(*validator.ValidatedClaims)
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		custom := claims.CustomClaims.(*CustomClaims)
		if !custom.HasScope(scope) {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "insufficient_scope"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func balanceHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{"balance": 4200})
}

func transferHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"status": "transferred"})
}
