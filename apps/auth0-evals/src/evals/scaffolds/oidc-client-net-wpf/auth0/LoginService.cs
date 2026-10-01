using Auth0.OidcClient;
using Microsoft.Extensions.Configuration;

namespace BarkbookApp;

/// <summary>
/// Wraps the Auth0 OIDC client. The WPF desktop app already logs the user in
/// through Universal Login and reads the signed-in user's name from the returned
/// claims.
/// </summary>
public class LoginService
{
    private readonly Auth0Client _client;

    public LoginService()
    {
        var config = new ConfigurationBuilder()
            .AddJsonFile("appsettings.json")
            .Build();

        _client = new Auth0Client(new Auth0ClientOptions
        {
            Domain = config["Auth0:Domain"]!,
            ClientId = config["Auth0:ClientId"]!,
        });
    }

    public async Task<string?> LoginAsync()
    {
        var result = await _client.LoginAsync();
        if (result.IsError)
        {
            return null;
        }

        return result.User.FindFirst("name")?.Value;
    }

    public Task LogoutAsync() => _client.LogoutAsync();
}
