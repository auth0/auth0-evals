import React from 'react';
import { SafeAreaView, Text, Button, View } from 'react-native';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';

function Home() {
  const { authorize, clearSession, user, isLoading, error } = useAuth0();

  if (isLoading) {
    return <Text>Loading…</Text>;
  }

  if (!user) {
    return (
      <View>
        <Text>Barkbook</Text>
        <Button title="Log In" onPress={() => authorize()} />
        {error && <Text>{error.message}</Text>}
      </View>
    );
  }

  return (
    <View>
      <Text>Welcome, {user.name}</Text>
      <Text>{user.email}</Text>
      <Button title="Log Out" onPress={() => clearSession()} />
    </View>
  );
}

export default function App() {
  return (
    <Auth0Provider domain="dev-barkbook.us.auth0.com" clientId="barkbook_client_abc123xyz">
      <SafeAreaView>
        <Home />
      </SafeAreaView>
    </Auth0Provider>
  );
}
