using Auth0.AspNetCore.Authentication.Api;
using BarkbookApi.Authorization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(args);

// Validates JWT access tokens. Domain and audience are read from configuration
// (appsettings.json / environment), never hardcoded.
builder.Services.AddAuth0ApiAuthentication(options =>
{
    options.Domain = builder.Configuration["Auth0:Domain"];
    options.JwtBearerOptions = new JwtBearerOptions
    {
        Audience = builder.Configuration["Auth0:Audience"],
    };
});

var issuer = $"https://{builder.Configuration["Auth0:Domain"]}/";

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("read:balance", policy =>
        policy.Requirements.Add(new HasScopeRequirement("read:balance", issuer)));
    options.AddPolicy("write:transfers", policy =>
        policy.Requirements.Add(new HasScopeRequirement("write:transfers", issuer)));
});

builder.Services.AddSingleton<IAuthorizationHandler, HasScopeHandler>();

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

// GET /api/balance — requires the read:balance scope.
app.MapGet("/api/balance", () => Results.Ok(new { balance = 4200 }))
    .RequireAuthorization("read:balance");

// POST /api/transfers — requires the write:transfers scope.
app.MapPost("/api/transfers", () => Results.Created("/api/transfers", new { status = "transferred" }))
    .RequireAuthorization("write:transfers");

app.Run();
