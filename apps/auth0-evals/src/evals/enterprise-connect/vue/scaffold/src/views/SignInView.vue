<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { signInWithPassword } from '../api.js';

// Barkbook's existing email + password sign-in. `?email=` pre-fills the form.
const route = useRoute();
const router = useRouter();
const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const password = ref('');
const error = ref(null);

async function handleSubmit() {
  try {
    await signInWithPassword(email.value, password.value);
    router.push('/dashboard');
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <main>
    <h1>Sign in to Barkbook</h1>
    <p v-if="error" role="alert">{{ error }}</p>
    <form @submit.prevent="handleSubmit">
      <label for="email">Email</label>
      <input id="email" v-model="email" type="email" required />
      <label for="password">Password</label>
      <input id="password" v-model="password" type="password" required />
      <button type="submit">Sign in</button>
    </form>
  </main>
</template>
