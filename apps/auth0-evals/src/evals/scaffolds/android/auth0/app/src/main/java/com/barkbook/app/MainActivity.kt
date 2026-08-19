package com.barkbook.app

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.auth0.android.Auth0
import com.auth0.android.authentication.AuthenticationAPIClient
import com.auth0.android.authentication.AuthenticationException
import com.auth0.android.authentication.storage.SecureCredentialsManager
import com.auth0.android.authentication.storage.SharedPreferencesStorage
import com.auth0.android.callback.Callback
import com.auth0.android.provider.WebAuthProvider
import com.auth0.android.result.Credentials

class MainActivity : ComponentActivity() {
    private lateinit var account: Auth0
    private lateinit var credentialsManager: SecureCredentialsManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        account = Auth0.getInstance(this)
        credentialsManager = SecureCredentialsManager(
            AuthenticationAPIClient(account),
            this,
            SharedPreferencesStorage(this)
        )

        setContent {
            BarkbookApp(
                isLoggedIn = credentialsManager.hasValidCredentials(),
                onLogin = { onLoggedIn -> login(onLoggedIn) },
                onLogout = { onLoggedOut -> logout(onLoggedOut) }
            )
        }
    }

    private fun login(onLoggedIn: (String?) -> Unit) {
        WebAuthProvider.login(account)
            .withScheme(getString(R.string.com_auth0_scheme))
            .withAudience("https://api.barkbook.com")
            .withScope("openid profile email offline_access")
            .start(this, object : Callback<Credentials, AuthenticationException> {
                override fun onSuccess(result: Credentials) {
                    credentialsManager.saveCredentials(result)
                    onLoggedIn(result.user.email)
                }

                override fun onFailure(error: AuthenticationException) {
                    Log.e("Barkbook", "Login failed", error)
                }
            })
    }

    private fun logout(onLoggedOut: () -> Unit) {
        WebAuthProvider.logout(account)
            .withScheme(getString(R.string.com_auth0_scheme))
            .start(this, object : Callback<Void?, AuthenticationException> {
                override fun onSuccess(result: Void?) {
                    credentialsManager.clearCredentials()
                    onLoggedOut()
                }

                override fun onFailure(error: AuthenticationException) {
                    Log.e("Barkbook", "Logout failed", error)
                }
            })
    }
}

@Composable
fun BarkbookApp(
    isLoggedIn: Boolean,
    onLogin: ((String?) -> Unit) -> Unit,
    onLogout: (() -> Unit) -> Unit
) {
    var isAuthenticated by remember { mutableStateOf(isLoggedIn) }
    var userEmail by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Barkbook",
            style = MaterialTheme.typography.headlineLarge
        )
        Spacer(modifier = Modifier.height(32.dp))

        if (isAuthenticated) {
            Text("Welcome!")
            if (userEmail.isNotEmpty()) {
                Text(
                    text = userEmail,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Spacer(modifier = Modifier.height(16.dp))
            Button(onClick = {
                onLogout {
                    isAuthenticated = false
                    userEmail = ""
                }
            }) {
                Text("Logout")
            }
        } else {
            Button(onClick = {
                onLogin { email ->
                    isAuthenticated = true
                    userEmail = email.orEmpty()
                }
            }) {
                Text("Login")
            }
        }
    }
}
