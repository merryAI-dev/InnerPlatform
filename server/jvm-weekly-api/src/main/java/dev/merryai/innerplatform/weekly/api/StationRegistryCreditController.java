package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class StationRegistryCreditController {
    private final StationRegistryCreditClient client;

    public StationRegistryCreditController(StationRegistryCreditClient client) {
        this.client = client;
    }

    @GetMapping("/registry-credits")
    public JsonNode read() {
        return client.read();
    }
}
