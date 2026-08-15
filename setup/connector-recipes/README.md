# Connector recipes

`catalog.json` maps discovered capabilities to provider identifiers, authentication mode, endpoint/credential environment-variable references, explicit read-tool allowlists, and one bounded harmless `doctor_probe` per capability. Recipe metadata does not make a provider safe: Rooty verifies the activated server and probe, while least privilege must still be enforced at the provider and database layers.
