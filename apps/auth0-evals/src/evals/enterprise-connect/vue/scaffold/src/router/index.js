import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import HomeView from '../views/HomeView.vue';
import SignInView from '../views/SignInView.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/signin', name: 'signin', component: SignInView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
    { path: '/', name: 'home', component: HomeView },
  ],
});
