package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"time"

	jwtmiddleware "github.com/auth0/go-jwt-middleware/v3"
	"github.com/auth0/go-jwt-middleware/v3/jwks"
	"github.com/auth0/go-jwt-middleware/v3/validator"
)

// The API validates Auth0 access tokens. The issuer and audience are read from
// the AUTH0_DOMAIN and AUTH0_AUDIENCE environment variables.
func newJWTMiddleware() *jwtmiddleware.JWTMiddleware {
	issuerURL, _ := url.Parse("https://" + os.Getenv("AUTH0_DOMAIN") + "/")

	provider, _ := jwks.NewCachingProvider(
		jwks.WithIssuerURL(issuerURL),
		jwks.WithCacheTTL(5*time.Minute),
	)

	jwtValidator, _ := validator.New(
		validator.WithKeyFunc(provider.KeyFunc),
		validator.WithAlgorithm(validator.RS256),
		validator.WithIssuer(issuerURL.String()),
		validator.WithAudiences([]string{os.Getenv("AUTH0_AUDIENCE")}),
	)

	return jwtmiddleware.New(jwtmiddleware.WithValidator(jwtValidator))
}

func balanceHandler(w http.ResponseWriter, r *http.Request) {
	claims, _ := jwtmiddleware.GetClaims[*validator.ValidatedClaims](r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"balance": 4200,
		"sub":     claims.RegisteredClaims.Subject,
	})
}

func main() {
	mw := newJWTMiddleware()

	http.Handle("/api/balance", mw.CheckJWT(http.HandlerFunc(balanceHandler)))

	http.ListenAndServe(":3001", nil)
}
