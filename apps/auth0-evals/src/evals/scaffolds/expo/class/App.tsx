import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import Auth0 from 'react-native-auth0';

const CUSTOM_SCHEME = 'barkbook';

const auth0 = new Auth0({
  domain: 'dev-barkbook.us.auth0.com',
  clientId: 'barkbook_client_abc123xyz',
});

export default function App() {
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const onLogin = async () => {
    await auth0.webAuth.authorize({}, { customScheme: CUSTOM_SCHEME });
    const credentials = await auth0.credentialsManager.getCredentials();
    const claims = decodeIdToken(credentials.idToken);
    setName(claims.name ?? null);
    setEmail(claims.email ?? null);
  };

  const onLogout = async () => {
    await auth0.webAuth.clearSession({}, { customScheme: CUSTOM_SCHEME });
    await auth0.credentialsManager.clearCredentials();
    setName(null);
    setEmail(null);
  };

  const isAuthenticated = name !== null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Barkbook</Text>

      {isAuthenticated ? (
        <>
          <Text>Welcome, {name}!</Text>
          <Text style={styles.caption}>{email}</Text>
          <Button title="Log Out" onPress={onLogout} />
        </>
      ) : (
        <Button title="Log In" onPress={onLogin} />
      )}

      <StatusBar style="auto" />
    </View>
  );
}

function decodeIdToken(idToken: string): { name?: string; email?: string } {
  const [, payload] = idToken.split('.');
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  caption: {
    fontSize: 12,
  },
});
