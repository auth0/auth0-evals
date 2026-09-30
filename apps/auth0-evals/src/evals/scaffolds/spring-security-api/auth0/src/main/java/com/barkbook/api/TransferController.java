package com.barkbook.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class TransferController {

    @GetMapping("/balance")
    public Map<String, Object> balance() {
        return Map.of("balance", 4200);
    }

    @PostMapping("/transfers")
    public Map<String, Object> transfer() {
        return Map.of("status", "transferred");
    }
}
