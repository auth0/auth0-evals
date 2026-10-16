import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { HomeComponent } from './pages/home/home.component';
import { SignInComponent } from './pages/signin/signin.component';

export const routes: Routes = [
  { path: 'signin', component: SignInComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: '', component: HomeComponent },
  { path: '**', redirectTo: '' },
];
