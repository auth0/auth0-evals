/**
 * @format
 */

import { Button, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';

function Home() {
  const { authorize, clearSession, user, error } = useAuth0();

  const onLogin = async () => {
    await authorize({ audience: 'https://api.barkbook.com', scope: 'openid profile email' });
  };

  const onLogout = async () => {
    await clearSession();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>Barkbook</Text>

      {user ? (
        <>
          <Text>Welcome!</Text>
          <Text style={styles.caption}>{user.email}</Text>
          <Button title="Log Out" onPress={onLogout} />
        </>
      ) : (
        <Button title="Log In" onPress={onLogin} />
      )}
      {error ? <Text style={styles.caption}>{error.message}</Text> : null}
    </View>
  );
}

function App() {
  return (
    <Auth0Provider domain="dev-barkbook.us.auth0.com" clientId="barkbook_client_abc123xyz">
      <Home />
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
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  caption: {
    fontSize: 12,
  },
});

export default App;
