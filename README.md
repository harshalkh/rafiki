# Rafiki

<img width="920" alt="rafiki" src="https://user-images.githubusercontent.com/3362563/119590055-e3347580-bd88-11eb-8ae7-958075433e48.png">

## What is Rafiki?

Rafiki is open source software that allows an [Account Servicing Entity](./packages/documentation/docs/reference/glossary.md#account-servicing-entity) to enable [Interledger](./packages/documentation/docs/reference/glossary.md#interledger-protocol) functionality on its users' accounts.

This includes

- sending and receiving payments (via [SPSP](./packages/documentation/docs/reference/glossary.md#simple-payments-setup-protocol-spsp) and [Open Payments](./packages/documentation/docs/reference/glossary.md#open-payments))
- allowing third-party access to initiate payments and view transation data (via [Open Payments](./packages/documentation/docs/reference/glossary.md#open-payments))

**❗ Rafiki is intended to be run by [Account Servicing Entities](./packages/documentation/docs/reference/glossary.md#account-servicing-entity) only and should not be used in production by non-regulated entities.**

Rafiki is made up of several components including an Interledger connector, a high-throughput accounting database called [TigerBeetle](./packages/documentation/docs/reference/glossary.md#tigerbeetle), and several APIs:

- the [Admin API](./docs/admin-api.md) to create [peering relationships](./packages/documentation/docs/reference/glossary.md#peer), add supported [assets](./packages/documentation/docs/reference/glossary.md#asset), and issue [payment pointers](./packages/documentation/docs/reference/glossary.md#payment-pointer)
- the [Open Payments](./packages/documentation/docs/reference/glossary.md#open-payments) API to allow third-parties (with the account holder's consent) to initiate payments and to view the transaction history
- the [SPSP](./packages/documentation/docs/reference/glossary.md#simple-payments-setup-protocol-spsp) API for simple Interledger Payments

Additionally, this package also includes a reference implementation of a [GNAP](./packages/documentation/docs/reference/glossary.md#grant-negotiation-authorization-protocol) authorization server which handles the access control for the [Open Payments](./packages/documentation/docs/reference/glossary.md#open-payments) API. For more information on the architecture, check out the [Architecture documentation](./packages/documentation/docs/introduction/architecture.md).

### New to Interledger?

Never heard of Interledger before, or you would like to learn more? Here are some good places to start:

- [Interledger Website](https://interledger.org/)
- [Interledger Specs](https://interledger.org/rfcs/0027-interledger-protocol-4/)
- [Interledger Explainer Video](https://twitter.com/Interledger/status/1567916000074678272)
- [Payment pointers](https://paymentpointers.org/)
- [Open Payments](https://openpayments.guide/)
- [Web monetization](https://webmonetization.org/)

## Contributing

Please read the [contribution guidelines](.github/contributing.md) before submitting contributions. All contributions must adhere to our [code of conduct](.github/code_of_conduct.md).

## Planning Calls

Our planning calls are open to our community. We have them every Tuesday at 12:30 GMT, via Google Meet.

**Google Meet joining info**

Video call link: https://meet.google.com/sms-fwny-ezc

Or dial: ‪(GB) +44 20 3956 0467‬ PIN: ‪140 111 239‬#

More phone numbers: https://tel.meet/sms-fwny-ezc?pin=5321780226087

[Add to Google Calendar](https://calendar.google.com/calendar/event?action=TEMPLATE&tmeid=YjN1NW5ibDloN2dua2IwM2thOWlrZXRvMTVfMjAyMzA0MTdUMTUwMDAwWiBjX2NqMDI3Z21oc3VqazkxZXZpMjRkOXB2bXQ0QGc&tmsrc=c_cj027gmhsujk91evi24d9pvmt4%40group.calendar.google.com&scp=ALL)

## Local Development Environment

### Prequisites

- [Docker](https://docs.docker.com/get-docker/)
- [NVM](https://github.com/nvm-sh/nvm)

### Environment Setup

```sh
# install node 18
nvm install lts/hydrogen
nvm use lts/hydrogen

# install pnpm
corepack enable

# if moving from yarn run
pnpm clean

# install dependencies
pnpm i
```

### Local Development

The Rafiki local environment is the best way to explore Rafiki locally. The [localenv](localenv) directory contains instructions for setting up a local playground.

### Useful commands

```sh
# build all the packages in the repo:
pnpm -r build
# build specific package (e.g. backend):
pnpm --filter backend build

# generate types from specific package GraphQL schema:
pnpm --filter backend generate

# run individual tests (e.g. backend)
pnpm --filter backend test

# run all tests
pnpm -r --workspace-concurrency=1 test

# format and lint code:
pnpm format

# check lint and formatting
pnpm checks

# verify code formatting:
pnpm check:format

# verify lint
pnpm check:lint
```
