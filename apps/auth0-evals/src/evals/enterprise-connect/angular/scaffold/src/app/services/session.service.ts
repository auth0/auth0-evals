import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';

export interface AppUser {
  id: string;
  email: string;
  name: string;
}

// Barkbook's existing sign-in, backed by its own API and session cookie.
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);

  signInWithPassword(email: string, password: string): Observable<AppUser> {
    return this.http.post<AppUser>('/api/session', { email, password }, { withCredentials: true });
  }

  fetchCurrentUser(): Observable<AppUser | null> {
    return this.http.get<AppUser>('/api/session', { withCredentials: true }).pipe(catchError(() => of(null)));
  }

  signOut(): Observable<void> {
    return this.http.delete<void>('/api/session', { withCredentials: true });
  }
}
