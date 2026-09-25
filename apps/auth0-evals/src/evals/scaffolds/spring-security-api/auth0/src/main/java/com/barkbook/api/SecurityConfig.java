package com.barkbook.api;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

import static org.springframework.security.config.Customizer.withDefaults;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(authorize -> authorize
                // GET /api/balance — requires the read:balance scope.
                .requestMatchers("/api/balance").hasAuthority("SCOPE_read:balance")
                // POST /api/transfers — requires the write:transfers scope.
                .requestMatchers("/api/transfers").hasAuthority("SCOPE_write:transfers")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(withDefaults()));
        return http.build();
    }
}
