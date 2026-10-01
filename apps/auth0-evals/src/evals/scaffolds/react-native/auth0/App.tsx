/**
 * @format
 */

import { useState } from 'react';
import { Alert, Button, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';

const AUTH0_DOMAIN = 'YOUR_AUTH0_DOMAIN';
const AUTH0_CLIENT_ID = 'YOUR_CLIENT_ID';
const AUDIENCE = 'YOUR_API_AUDIENCE';

function LoginScreen() {
  const { auth, credentialsManager } = useAuth0();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  async function handleLogin() {
    try {
      const credentials = await auth.passwordRealm({
        username,
        password,
        realm: 'Username-Password-Authentication',
        audience: AUDIENCE,
        scope: 'openid profile email offline_access',
      });
      await credentialsManager.saveCredentials(credentials);
      setIsLoggedIn(true);
    } catch (error) {
      // TODO: handle MFA step-up — detect MFA-required error and complete the MFA flow
      Alert.alert('Login failed', String(error));
    }
  }

  async function handleTransfer() {
    // TODO: handle MFA step-up before transferring
    Alert.alert('Transfer', 'Transfer initiated');
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>Barkbook</Text>

      {isLoggedIn ? (
        <>
          <Text>Welcome!</Text>
          <Button title="Transfer" onPress={handleTransfer} />
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Button title="Log In" onPress={handleLogin} />
        </>
      )}
    </View>
  );
}

function App() {
  return (
    <Auth0Provider domain={AUTH0_DOMAIN} clientId={AUTH0_CLIENT_ID}>
      <LoginScreen />
    </Auth0Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
});

export default App;
