package dev.merryai.innerplatform.weekly.api;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateFirebaseSessionRequest(
    @NotBlank @Size(max = 8192) String idToken
) {
}
