<template>
  <main>
    <h1>BarkBook</h1>
    <div v-if="!isLoading">
      <div v-if="isAuthenticated">
        <p>Welcome, {{ user?.name }}</p>
        <button @click="logout({ logoutParams: { returnTo: window.location.origin } })">Log Out</button>
      </div>
      <div v-else>
        <button @click="loginWithRedirect()">Log In</button>
      </div>
    </div>
  </main>
</template>

<script setup>
import { useAuth0 } from '@auth0/auth0-vue';

const { loginWithRedirect, logout, isAuthenticated, isLoading, user } = useAuth0();
</script>
