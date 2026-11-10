# API keys

Use API keys to authenticate API requests.

Stripe uses API keys to authenticate requests from your integration. Every request to the Stripe API must include a key. We check this key’s authenticity to associate it with your Stripe integration.

There are two kinds of keys:

| Key type | Prefix | Used in | Visibility |
| --- | --- | --- | --- |
| Publishable key | `pk_` | Client-side code (mobile apps, browser JS) | Safe to expose publicly |
| Secret key | `sk_` or `rk_` | Server-side code | Must be kept confidential |

Each secret key has permissions that control which API operations it can perform. Full-access keys start with `sk_` and restricted keys start with `rk_`. Grant only the permissions your integration needs. See [Protect your keys](https://docs.stripe.com/keys.md#protect-your-keys).

Use the [API keys](https://dashboard.stripe.com/apikeys) page in the Dashboard to create, reveal, expire, rotate, and view logs associated with a key.

## Use API keys

Pass your secret key as the value of the `Authorization` header on every server-side API request. If you use the Stripe SDKs, you pass your API key only once during Stripe client initialization.

For example, here’s how to create a [Customer](https://docs.stripe.com/api/customers/create.md) using a secret key that has **Write** access to **Customers**:

```curl
curl https://api.stripe.com/v1/customers \
  -u "<<YOUR_SECRET_KEY>>:" \
  --data-urlencode "email=jenny.rosen@example.com" \
  -d payment_method=pm_card_visa \
  -d "invoice_settings[default_payment_method]=pm_card_visa"
```

Use your **publishable key** for any request made directly from a browser or mobile app, such as initializing Stripe.js or a mobile SDK. Never put a secret key directly in your code, or use a secret key from client code such as a browser session or mobile app.

If a request doesn’t include a valid key, Stripe returns an [invalid request error](https://docs.stripe.com/error-handling.md#invalid-request-errors). If a request includes an expired key, Stripe returns an [authentication error](https://docs.stripe.com/error-handling.md#authentication-errors). If a request uses a key that lacks a required permission, Stripe returns a [permission error](https://docs.stripe.com/error-handling.md#permission-errors). Use [Workbench request logs](https://docs.stripe.com/workbench.md) to inspect API requests and troubleshoot errors.

> #### If you're new to Stripe
> 
> - **Keep your business safe**: Read our [best practices](https://docs.stripe.com/keys-best-practices.md) for managing keys.
> - **Build and test**: Create or select a [sandbox](https://docs.stripe.com/sandboxes.md) and use its test keys. For new integrations, use a separate general sandbox so settings and data remain isolated from live mode. Sandbox keys start with `pk_test_` and `sk_test_`.
> - **When you’re ready to accept real payments**: Switch to your live-mode publishable key (`pk_live_`) for client-side code, and [create a live-mode secret key](https://docs.stripe.com/keys.md#create-a-secret-key) (`rk_live_` or `sk_live_`) with the permissions your server-side application needs. See [Switch to live mode](https://docs.stripe.com/keys.md#switch-to-live-mode).
> - **If you need to find a webhook signing secret**: Webhook secrets are separate from API keys. Find them in the [Webhooks](https://dashboard.stripe.com/webhooks) section of the Dashboard under each webhook endpoint.

## Key types 

### Publishable keys

A publishable key (`pk_test_...` or `pk_live_...`) identifies your Stripe account in client-side code, such as a checkout page or mobile app. It’s safe to expose because it can’t read or modify data. Use it to create tokens or initialize Stripe.js, Elements, and the Stripe mobile SDKs.

Stripe automatically creates a publishable key in sandboxes and in live mode. Copy or rotate it from the [API keys](https://dashboard.stripe.com/apikeys) page. Publishable keys don’t expire.

### Secret keys 

A secret key (`sk_...` or `rk_...`) authenticates server-side requests. You must keep it confidential. When you create a secret key, you choose the permissions it has. You can assign:

- **A permission template**: A curated set of permissions matching a common integration use case (for example, “One-time payments” or “Recurring subscriptions and billing”).
- **Custom permissions**: Select individual permissions, or quick-select all permissions in a section (for example, all Core `write` permissions).
- **Full access (except sensitive permissions)**: Every permission, other than elevated-risk operations that could result in money leaving your account, such as making outbound payments or creating connected accounts.
- **Full access**: Every permission on the Stripe API. If you use a full-access key and accidentally expose it, your entire account is at risk. Use a full-access key only if your integration genuinely needs access to every kind of Stripe resource.

Grant the fewest permissions your integration needs to [protect your keys](https://docs.stripe.com/keys.md#protect-your-keys).

### Organization API keys

If your Stripe account is part of an [organization](https://docs.stripe.com/get-started/account/orgs.md), you can create secret keys scoped to the organization rather than to a single account. Organization keys let you make API calls across every account in your organization, and are useful for platform-level tooling or internal services that operate across multiple Stripe accounts. Create and manage them from the organization-level [API keys](https://dashboard.stripe.com/org/api-keys/secret) page.

When you create a key from your organization’s API keys page, select the scope that matches the resources your integration accesses:

- **Organization level**: Creates an organization API key that can access every account in the organization and organization-level resources.
- **Account level**: Creates an account-level key to access resources for one account.

Select the narrowest scope your integration needs. You can’t change a key’s scope after you create it. To use a different scope, create another key.

For request requirements, security guidance, and examples, see [Organization API keys](https://docs.stripe.com/keys/organization-api-keys.md).

## Create a secret key 

1. Go to the [API keys page for your account](https://dashboard.stripe.com/apikeys) or the [API keys page for your organization](https://dashboard.stripe.com/org/api-keys/secret). Select **Create secret key**.
2. On the **Choose how you’ll use this key** screen, select the option that matches your integration (for example, building your own integration, using a third-party plugin, or giving access to an AI agent).
3. If you’re creating the key from your organization’s [API keys](https://dashboard.stripe.com/org/api-keys/secret) page, the **Set the key scope** screen appears. Select **Organization level** or **Account level**. If you choose **Account level**, select an account. See [Organization API keys](https://docs.stripe.com/keys.md#organization-api-keys) to compare scopes.
4. On the **Assign permissions to your key** screen, choose a permission template, custom permissions, full access (except sensitive permissions), or full access.
5. On the **Name and review your key** screen, enter a name and optionally a note, then click **Create key**.
6. Click the key token to copy it, then save it in a safe place such as your platform’s secrets vault. You can’t view the token again later without rotating your key.

You can change a key’s permissions after you create it, except for full-access keys, which can’t be scoped down. See [Assign permissions to a secret key](https://docs.stripe.com/keys.md#assign-permissions). 

## Assign permissions to a secret key 

You can configure a key’s permissions to fit your specific use cases in line with the principle of least privilege: a key should have the minimum permissions necessary to do its job, and no more. Here are several practical approaches to assign permissions.

### Elevated risk permissions

When you choose a key’s permissions in the Dashboard, you’ll see an **Elevated risk** warning next to some permissions. A compromised key with elevated-risk permissions can cause significant harm to your business. Grant these permissions only when a service needs them. Prefer **Read** over **Write**, and isolate elevated-risk permissions in a dedicated key. See [Use one secret key per service or use case](https://docs.stripe.com/keys.md#use-one-key-per-service).

Elevated risk permissions include:

- **Money movement**: Money Management (financial accounts, financial addresses, inbound and outbound transfers, outbound payments, and payout methods), Treasury, Payouts, Transfers, Platform Transfers, Top-ups, and Balance Transfers. A leaked key with **Write** access can send money out of your account.
- **Card issuing**: Issuing, which can create and manage spending cards and controls.
- **Account and platform control**: Connect Platform permissions, which can create new connected accounts and act across your existing accounts.
- **Credentials and access management**: API keys and other account access (IAM) permissions, which can create or modify keys and team access—effectively escalating a key’s own reach.
- **Sensitive identity data**: Identity verification PII and KYC data, including identity document numbers and raw bank account details. Some of these require an IP allowlist and can’t be combined with other permissions on the same key.

Before you save a key’s permissions, the summary screen highlights any elevated-risk permissions you need to review.

### Audit request logs to determine permissions

1. Go to the [API Keys](https://dashboard.stripe.com/apikeys) page in the Dashboard.
2. Find the key you’re configuring.
3. Click the overflow menu (⋯) next to the key.
4. Click **View request logs** to see all of the requests made with that key.

Review successful requests to identify the resources and access your application needs:

- `GET` requires read permission.
- `POST` and `DELETE` require write permission.

Remove permissions the key didn’t use. If requests failed, filter the logs for unsuccessful requests and identify the missing permissions. To update the key, open the overflow menu (⋯), click **Edit key**, and adjust its permissions.

When editing permissions, paste the permission code from an API error response into **Search by resource or endpoint** to find the corresponding permission. To find the permissions each API endpoint requires, see the [API permissions reference](https://docs.stripe.com/keys/permissions-reference.md).

### Review your code

You can build a list of required permissions by searching your codebase for Stripe SDK calls. Map each call to the corresponding permission in the Dashboard. For example:

- `PaymentIntent.create(...)`: **PaymentIntents: Write**
- `Customer.retrieve(...)`: **Customers: Read**
- `Dispute.list(...)`: **Disputes: Read**

Then configure your key’s permissions to match only what you found.

### Test and refine permissions in a sandbox

You can initially give a key broad permissions, then remove any excess permissions after reviewing how the key is used.

In a sandbox, create a secret key from the API keys menu. The available permissions are grouped into categories. If you know your Stripe API usage doesn’t include a particular category, such as Stripe Billing, you can select **None** for that category. Otherwise, select **Write** for categories that are relevant to your Stripe API usage. **Write** permissions include **Read** permissions: if a key can write an API resource, it can also read that resource.

Test your application with the sandbox key so your application uses the key to make Stripe API requests. Test every component of your application that uses Stripe APIs.

Remove permissions you granted but didn’t use during your testing, and change Write permissions to Read as appropriate.

## Use one secret key per service or use case 

If you have multiple services that use Stripe APIs (for example, a billing service, a reporting service, and a webhook handler), create a separate secret key for each service, and give each key only the Stripe API permissions that its service needs. Granting separate permissions lets you limit the potential impact if any one of your services is compromised.

## Sandbox versus live mode 

API requests occur in either a *sandbox* (A sandbox is an isolated test environment that allows you to test Stripe functionality in your account without affecting your live integration. Use sandboxes to safely experiment with new features and changes) or *live mode* (Use this mode when you’re ready to launch your app. Card networks or payment providers process payments). You can use a sandbox to test your integration and access test data, and live mode to access actual account data. Sandbox and live-mode objects use separate API keys, and objects in one mode can’t access the other. For example, a sandbox [product object](https://docs.stripe.com/api/products/object.md) can’t be part of a live mode payment.

When you create a Stripe account or a new sandbox, Stripe creates sandbox keys for you: a publishable key (`pk_test_...`) and a full-access secret key (`sk_test_...`). For live mode, Stripe provides publishable key (`pk_live_...`). You [create a live-mode secret key](https://docs.stripe.com/keys.md#create-a-secret-key) with the permissions your application needs.

| Type | When to use | Objects | How to use | Considerations |
| --- | --- | --- | --- | --- |
| Sandboxes | Use a sandbox, and its associated test API keys, as you build your integration. In a sandbox, card networks and payment providers don’t process payments. | API calls return simulated objects. For example, you can retrieve and use test [Customer](https://docs.stripe.com/api/customers/object.md), [PaymentIntent](https://docs.stripe.com/api/payment_intents/object.md), [Refund](https://docs.stripe.com/api/refunds/object.md), and [Subscription](https://docs.stripe.com/api/subscriptions/object.md) objects. | Use [test credit cards and accounts](https://docs.stripe.com/testing.md#cards). You can’t accept real payment methods or work with real accounts. | [Identity](https://docs.stripe.com/identity.md) doesn’t perform any verification checks. Also, Connect [account objects](https://docs.stripe.com/api/accounts/object.md) don’t return sensitive fields. |
| Live mode | Use live mode, and its associated live API keys, when you’re ready to launch your integration and accept real money. In live mode, card networks and payment providers do process payments. | API calls return real objects. For example, you can retrieve and use real [Customer](https://docs.stripe.com/api/customers/object.md), [PaymentIntent](https://docs.stripe.com/api/payment_intents/object.md), [Refund](https://docs.stripe.com/api/refunds/object.md), and [Subscription](https://docs.stripe.com/api/subscriptions/object.md) objects. | Accept real credit cards and work with customer accounts. You can accept actual payment authorizations, charges, and captures for credit cards and accounts. | Disputes have a more nuanced flow and a simpler [testing process](https://docs.stripe.com/testing.md#disputes). Also, some [payment methods](https://docs.stripe.com/payments/payment-methods.md) have a more nuanced flow and require more steps.
In live mode, Stripe doesn’t create a secret key for you automatically. You can create a secret API key with the permissions your application needs. |

## API keys for autonomous agents 

You can tag a secret key as belonging to an AI agent that needs persistent access to your account to complete tasks such as processing refunds or managing subscriptions. To tag a key as an agent key, select **Giving an AI agent access to operate your account** when Stripe prompts you.

Agent-tagged keys authenticate and enforce permissions like other secret keys. However, agent-tagged keys are automatically subject to [approval rules](https://docs.stripe.com/account/approvals.md), which require a designated reviewer to approve sensitive actions before they take effect. Stripe provides a set of default rules, covering elevated-risk actions such as payouts and refunds.

This is the recommended way to give autonomous agents access to your Stripe account. [Approval rules](https://docs.stripe.com/account/approvals.md) act as a safeguard against agent mistakes, unexpected behavior, and hallucinations.

## Protect your keys 

Only publishable keys are safe to expose outside your application’s back end.  You’re responsible for protecting your secret API keys. To protect your keys:

- Store sensitive keys in a secrets vault provided by your hosting platform. See [this example](https://stripe.dev/blog/securing-stripe-api-keys-aws-automatic-rotation). If you can’t use a secrets vault, use environment variables to provide keys to your backend applications.
- Don’t put keys in source code or configuration files checked into version control.
- Grant each key only the permissions it needs, instead of full access.
- Configure [access policies](https://docs.stripe.com/keys.md#access-policies) to control where your keys can be used and automatically block common threats.
- [Rotate keys](https://docs.stripe.com/keys.md#rolling-keys) when team members with access to the keys leave your organization.
- Don’t share keys over email, chat, or other unencrypted channels.

For a comprehensive guide, see [best practices for managing secret API keys](https://docs.stripe.com/keys-best-practices.md). We also maintain [a library of skills](https://github.com/stripe/ai/tree/main/skills) to help AI agents follow these best practices.

## Manage your API keys

The following sections describe how to manage keys on the API keys page.

### Reveal a secret key 

When you create a secret key in live mode, Stripe displays it one time before you save it. Copy the key before you save it, because you can’t reveal it later. Stripe can’t recover keys that you’ve forgotten or lost access to. If you lose a key, rotate or delete it and create another.

In sandbox mode, you can always reveal secret key tokens after creation. Publishable keys aren’t sensitive, so we show them by default.

> Store sensitive keys in a place where you won’t lose them, such as a secrets vault provided by your platform. Don’t put keys in your application’s code.

### Limit an API key to certain IP addresses 

[Access policies](https://docs.stripe.com/keys.md#access-policies) have replaced IP address restrictions.

### Change an API key’s name or note 

1. On the [API keys](https://dashboard.stripe.com/apikeys) page, click the overflow menu (⋯) for the key you want to change.
2. Select **Edit key**.
3. Do the following:
   - To change the name, enter a new name in the **name** field.
   - To change the note text, enter the new note text in the **Note** field.
4. Click **Save**.

### Expire an API key 

If you expire a secret key, you must create a new one and update any code that uses the expired key. Code that uses the expired key can no longer make API calls.

> You can’t expire a publishable key.

1. On the [API keys](https://dashboard.stripe.com/apikeys) page, in the **API keys** list, click the overflow menu (⋯) for the key you want to expire.
2. Select **Expire key**.
3. In the dialog, click **Expire key**. If you no longer want to expire the key, click **Cancel**.

### Rotate an API key 

Rotating an API key expires it and generates a replacement key that’s ready to use immediately, with the same name and permissions. You can also schedule a key to expire after a certain time, letting you replace the new key in your code.

Rotate an API key if:

- You lose a secret API key in live mode, and you can’t recover it from the Dashboard.
- A secret API key is compromised, and you need to revoke it to block any potentially malicious API requests that might use the key.
- A team member with access to the key leaves your organization or changes roles.
- Your organization requires rotating keys periodically.

#### Rotate safely to avoid downtime

1. **Use the grace period**: When you rotate a key in the Dashboard, both the old and new keys work for up to 7 days. This lets you migrate gradually without downtime. If you need more than 7 days, create a new key manually, migrate to it, then expire the old one when you’re done.
2. **Roll out gradually**: If possible, use the new key from a small subset of your servers or services first, and watch your server logs for errors before deploying further.
3. **Monitor before revoking**: Before the old key expires, [check its request logs](https://docs.stripe.com/keys.md#view-request-logs), and expire it only after its request volume has been at zero for a few hours or days.

#### Rotate an API key in the Dashboard

1. On the [API keys](https://dashboard.stripe.com/apikeys) page, click the overflow menu (⋯) for the key you want to rotate.
2. Select **Rotate key**.
3. Select an expiration date from the **Expiration** dropdown. If you choose **Now**, the old key is deleted. If you specify a time, the remaining time until the key expires displays below the key name.
4. Click **Rotate API key**.
5. Click the key value to copy it and save it. You can’t retrieve it later.
6. In the **Add a note** field, enter the location where you saved the key, then click **Rotate**.

### Restore an API key’s access 

Stripe can limit an API key’s access if it hasn’t been used to create transfers, payouts, or update payout destinations for over 180 days. You can’t use a limited-access key to create payouts and transfers or to create payout destinations. You can restore access to use the key normally or to perform a blocked action. To learn more, see [Why does my API key have limited access](https://support.stripe.com/questions/why-does-my-api-key-have-limited-access).

1. On the [API keys](https://dashboard.stripe.com/apikeys) page, click the overflow menu (⋯) for the key you want to restore.
2. Select **Restore access**.
3. Click **Restore**.

## View API request logs for a key 

To [open the API request logs](https://docs.stripe.com/workbench/overview.md#request-logs), click the overflow menu (⋯) for any key, then select **View request logs**. Opening the logs redirects you to Workbench in the Stripe Dashboard.

## Transitioning to live mode 

When you’re ready to accept real payments, use live-mode API keys instead of sandbox keys. On the [API keys](https://dashboard.stripe.com/apikeys) page, toggle from **sandbox mode** to **live mode**. The page now shows your live-mode API keys.

> #### Complete go-live checklist
> 
> Review the full [go-live checklist](https://docs.stripe.com/get-started/checklist/go-live.md) to make sure your integration is production ready.

### Publishable keys (client-side)

Copy your **live-mode publishable key** (starts with `pk_live_`) and replace the `pk_test_` key in your client-side code. It’s safe to embed this key in your code or apps.

### Secret keys (server-side)

Server-side API keys are sensitive, so review our [best practices for managing secret API keys](https://docs.stripe.com/keys-best-practices.md). Create a secret key with only the permissions your server-side code needs to limit the damage to your business if the key is ever exposed or compromised.

1. Before you start using a live-mode key in your backend application, remove any hardcoded API keys from your code. Instead, use a [secrets vault](https://docs.stripe.com/keys-best-practices.md#use-a-secrets-vault) to supply the sandbox key, and confirm that your application still works. If your platform doesn’t provide a secrets vault, you can use an environment variable.
2. [Create a live-mode secret key](https://docs.stripe.com/keys.md#create-a-secret-key) with the permissions your application needs. To view the API calls made by a sandbox API key, click the overflow menu (⋯) next to the key, and click **View request logs**. You can also review your code for Stripe SDK calls and look up their corresponding permissions in the permission-selection step.
3. Store the key value securely in your server environment.
4. Configure your server environment to supply live-mode keys instead of sandbox keys to your application.

#### Webhook signing keys (server-side)

If you use webhooks, update each webhook endpoint’s URL and copy the new **signing secret** from the [Webhooks](https://dashboard.stripe.com/webhooks) section of the Dashboard.

Use that signing secret to [verify that events are sent from Stripe](https://docs.stripe.com/webhooks.md#verify-events) before you act on them. Without verification, an attacker could send fake webhook events to your endpoint. Stripe also sends webhook events from a set list of [IP addresses](https://docs.stripe.com/ips.md) that you can allowlist on your server or firewall.

## Access policies

You can restrict access to a key by attaching an access policy to it. If someone attempts a request using a key they can’t access, Stripe blocks the request and notifies you.

Configure access policies on all live-mode keys. Stripe will notify you of any unauthorized access, so you can rotate a key if it has been used outside your integration and investigate how it was exposed. See [Protecting against compromised API keys](https://support.stripe.com/questions/protecting-against-compromised-api-keys) for what to do next.

You can manage your integration’s access by assigning different policies to different keys. For example, you can assign separate policies to keys used in staging and production.

### Access policy types

Stripe supports the following types of access policies:

- **IP addresses**: Restrict access to one or more specific IPv4 addresses or CIDR ranges. Use this approach if your servers have fixed IP addresses.
- **Advanced**: Restrict access by Autonomous System Number (ASN), country, and block certain kinds of high-risk sources. If you don’t use fixed IP addresses, you can grant access to Stripe from your cloud provider using its ASN and country.

An advanced access policy can use any combination of the following rules:

- **ASNs to allow**: Requests from specified ASNs are allowed; all others are blocked.
- **Countries**: Requests from specified countries are allowed; all others are blocked.
- **Sources**: Requests from selected sources are blocked. You can select the following sources:
  - **Anonymous VPNs**: Third-party VPN services sold for privacy and anonymity (not including corporate VPNs). Consider blocking these if you don’t use VPNs to access the Stripe API.
  - **Public proxies**: Open proxy servers from public lists. Consider blocking these if you don’t use public proxies to access the Stripe API.
  - **Residential proxies**: Proxies associated with residential ISPs. Consider blocking these if you don’t use residential ISPs to access the Stripe API.
  - **Tor exit nodes**: Traffic from the Tor network. Consider blocking these if you don’t access the Stripe API over Tor.

Selecting multiple rules combines them using AND logic. For example, if you allow ASN 16509 (Amazon), allow the United States, and block Tor exit nodes, then the policy allows only requests from AWS IPs in the US that are not known to be Tor exit nodes. It blocks all other requests.

### Create an access policy

To create an access policy, go to the [Access policies](https://dashboard.stripe.com/api-access-policies) page in your Dashboard and follow these steps:

1. Click **+ Create policy**.
2. Enter a name (for example, “Production servers”) and an optional description.
3. Select **IP addresses** or **Advanced**.
4. Depending on the selected type, configure the policy:
   - **IP addresses**: Enter one or more valid public IPv4 addresses or CIDR ranges. For example, `192.0.2.0/24` covers the range 192.0.2.0–192.0.2.255.
   - **Advanced**: Specify any combination of ASNs to allow, countries to allow, and sources to block, as described in [Access policy types](https://docs.stripe.com/keys.md#access-policy-types).
5. Click **Next**.
6. Review the policy details, then click **Create policy**.
7. If prompted to authenticate, follow the on-screen instructions.

If the creation succeeded, the new policy appears in the list.

### Apply or remove an access policy

To apply an access policy to an API key, go to the [API keys](https://dashboard.stripe.com/apikeys) page in the Dashboard and follow these steps:

1. In the **API keys** list, find the key you want to update and open its overflow menu (⋯).
2. Select **Manage access policy**.
3. In the **Access policy** dropdown, select the policy you want.
4. Review the details of the selected policy, then click **Save**.
5. If prompted to authenticate, follow the on-screen instructions.

To remove an access policy from a key, go to the [API keys](https://dashboard.stripe.com/apikeys) page in your Dashboard and follow these steps:

1. In the **API keys** list, find the key you want to update and open its overflow menu (⋯).
2. Select **Manage access policy**.
3. In the **Access policy** dropdown, select **None**, then click **Save**.

### Update an access policy

To make changes to an access policy, go to the [Access policies](https://dashboard.stripe.com/api-access-policies) page in your Dashboard and follow these steps:

1. Find the policy you want to change, and open its overflow menu (⋯).
2. Select **Edit policy**.
3. Update the policy options as described in [Create an access policy](https://docs.stripe.com/keys.md#create-an-access-policy), then click **Next**.
4. Review the policy details, then click **Save**.
5. If prompted to authenticate, follow the on-screen instructions.

When you update an access policy, the changes apply immediately to all API keys it’s assigned to.

### Delete an access policy

To delete an access policy, go to the [Access policies](https://dashboard.stripe.com/api-access-policies) page in the Dashboard and follow these steps:

1. Find the policy you want to delete and open its overflow menu (⋯).
2. Select **Delete policy**.
3. Review the confirmation dialog to understand the impact, then click **Delete policy**.

Deleting an access policy immediately removes it from all API keys it was applied to. Those keys allow requests from any source until you apply another policy to them.

## See also

- [Best practices for managing secret API keys](https://docs.stripe.com/keys-best-practices.md)
- [Approval requests](https://docs.stripe.com/account/approvals.md)
- [Protecting against compromised API keys](https://support.stripe.com/questions/protecting-against-compromised-api-keys)
- [Why does my API key have limited access](https://support.stripe.com/questions/why-does-my-api-key-have-limited-access)
- [Test your integration](https://docs.stripe.com/testing.md)