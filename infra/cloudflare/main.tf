locals {
  vercel_records = {
    for app in var.vercel_apps : app.hostname => {
      name    = app.hostname
      type    = "A"
      content = "76.76.21.21"
      ttl     = app.ttl
    } if app.enabled
  }

  extra_web_records = {
    for record in var.extra_web_records : record.name => record
  }

  web_records = merge(local.vercel_records, local.extra_web_records)
}

resource "cloudflare_dns_record" "web" {
  for_each = {
    for name, record in local.web_records : name => record
  }

  zone_id = var.cloudflare_zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  ttl     = each.value.ttl
  proxied = var.web_records_proxied
}

resource "cloudflare_zone_setting" "ssl_mode" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "brotli" {
  zone_id    = var.cloudflare_zone_id
  setting_id = "brotli"
  value      = "on"
}

resource "cloudflare_ruleset" "managed_waf" {
  count   = var.enable_managed_waf ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "MYSC managed WAF baseline (${var.config_status})"
  kind    = "zone"
  phase   = "http_request_firewall_managed"

  rules = [
    {
      action      = "execute"
      expression  = "true"
      description = "Cloudflare Managed Ruleset"
      ref         = "mysc_cloudflare_managed_ruleset"
      action_parameters = {
        id = "efb7b8c949ac4650a09736fc376e9aee"
      }
    },
    {
      action      = "execute"
      expression  = "true"
      description = "Cloudflare OWASP Core Ruleset"
      ref         = "mysc_cloudflare_owasp_core_ruleset"
      action_parameters = {
        id = "4814384a9e5d4991b9815dcfc25d2f1f"
      }
    }
  ]
}

resource "cloudflare_ruleset" "custom_waf" {
  zone_id = var.cloudflare_zone_id
  name    = "MYSC custom WAF controls (${var.config_status})"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  lifecycle {
    ignore_changes = [name]
  }

  rules = [
    {
      action      = "managed_challenge"
      expression  = var.admin_path_expression
      description = "Managed challenge for privileged routes"
      ref         = "mysc_privileged_browser_routes_managed_challenge"
    },
    {
      action      = "block"
      expression  = "(http.request.uri.query contains \"../\" or http.request.uri.query contains \"..%2f\" or http.request.uri.query contains \"<script\" or http.request.uri.query contains \"union select\" or http.request.uri.query contains \"or 1=1\")"
      description = "Block obvious injection probes in query string"
      ref         = "mysc_obvious_query_injection_probe_block"
    },
    {
      action      = "block"
      expression  = "(http.request.uri.path contains \"/.env\" or http.request.uri.path contains \"/wp-admin\" or http.request.uri.path contains \"/phpmyadmin\" or http.request.uri.path contains \"/server-status\")"
      description = "Block common scanner paths"
      ref         = "mysc_common_scanner_path_block"
    }
  ]
}

resource "cloudflare_ruleset" "rate_limits" {
  count   = var.enable_rate_limits ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "MYSC rate limits (${var.config_status})"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [
    {
      action      = "managed_challenge"
      expression  = var.login_path_expression
      description = "Protect login and auth endpoints"
      ref         = "mysc_login_rate_limit_managed_challenge"
      ratelimit = {
        characteristics     = ["ip.src", "cf.colo.id"]
        period              = 60
        requests_per_period = 20
        mitigation_timeout  = 600
      }
    },
    {
      action      = "managed_challenge"
      expression  = var.api_path_expression
      description = "Protect API endpoints from burst abuse"
      ref         = "mysc_api_rate_limit_managed_challenge"
      ratelimit = {
        characteristics     = ["ip.src", "cf.colo.id"]
        period              = 60
        requests_per_period = 120
        mitigation_timeout  = 300
      }
    }
  ]
}

resource "cloudflare_ruleset" "legacy_redirects" {
  count   = length([for redirect in var.legacy_redirects : redirect if redirect.enabled]) > 0 ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "MYSC legacy host redirects (${var.config_status})"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [
    for redirect in var.legacy_redirects : {
      action      = "redirect"
      expression  = "(http.host eq \"${redirect.hostname}\")"
      description = "Redirect ${redirect.hostname} to ${redirect.target}"
      ref         = "mysc_legacy_redirect_${replace(replace(redirect.hostname, ".", "_"), "-", "_")}"
      enabled     = redirect.enabled
      action_parameters = {
        from_value = {
          preserve_query_string = true
          status_code           = 301
          target_url = {
            expression = "concat(\"${redirect.target}\", http.request.uri.path)"
          }
        }
      }
    } if redirect.enabled
  ]
}
