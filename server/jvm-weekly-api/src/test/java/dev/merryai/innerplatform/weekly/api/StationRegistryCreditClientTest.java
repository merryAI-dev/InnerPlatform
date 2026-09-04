package dev.merryai.innerplatform.weekly.api;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class StationRegistryCreditClientTest {
    @Test
    void readsStationWithMetadataIdentityTokenAndNeverWrites() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/token", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("GET");
            assertThat(exchange.getRequestHeaders().getFirst("Metadata-Flavor")).isEqualTo("Google");
            byte[] body = "short-lived-oidc".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.createContext("/credits", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("GET");
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer short-lived-oidc");
            byte[] body = "{\"source\":\"station\",\"readOnly\":true,\"people\":[{\"workEmail\":\"jtkim@mysc.co.kr\",\"totalCredit\":4150}]}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            URI root = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
            StationRegistryCreditClient client = new StationRegistryCreditClient(
                root.resolve("/credits"), root.resolve("/token")
            );

            assertThat(client.read().path("readOnly").asBoolean()).isTrue();
            assertThat(client.read().path("people").get(0).path("totalCredit").asInt()).isEqualTo(4150);
        } finally {
            server.stop(0);
        }
    }
}
