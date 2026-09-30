using System.IO;
using System.Windows;
using Auth0.OidcClient;
using Microsoft.Extensions.Configuration;

namespace BarkbookDesktop;

public partial class MainWindow : Window
{
    private readonly Auth0Client _auth0Client;
    private readonly string _audience;

    public MainWindow()
    {
        InitializeComponent();

        var config = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json")
            .Build();

        _audience = config["Auth0:Audience"]!;

        _auth0Client = new Auth0Client(new Auth0ClientOptions
        {
            Domain = config["Auth0:Domain"],
            ClientId = config["Auth0:ClientId"],
            Scope = "openid profile email",
        });
    }

    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        var loginResult = await _auth0Client.LoginAsync(new { audience = _audience });
        if (loginResult.IsError)
        {
            StatusText.Text = $"Login failed: {loginResult.Error}";
            return;
        }

        StatusText.Text = $"Signed in as {loginResult.User.Identity?.Name}";
    }

    private async void TransferButton_Click(object sender, RoutedEventArgs e)
    {
        // TODO: Transfers are a high-value action that require MFA step-up.
        // Trigger step-up before performing the transfer, then confirm MFA
        // actually happened before proceeding.
        MessageBox.Show("Transfer not implemented.");
    }
}
