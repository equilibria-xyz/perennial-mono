# Perennial Protocol

Smart contracts for the core perennial protocol.

## Usage

### Pre Requisites

This repo works best with Node.js v16.x.x, this is preconfigured for users of [asdf](https://asdf-vm.com/).

Before running any command, make sure to install dependencies:

```sh
$ yarn
```

### Compile

Compile the smart contracts with Hardhat and Typechain:

```sh
$ yarn compile
```

### Test

Run the Mocha tests:

```sh
$ yarn test
```

To run integration tests against a Mainnet fork, set your `MAINNET_NODE_URL` in `.env` and run

```sh
$ yarn test:integration
```

### Gas Report

To get a gas report based on integration test calls:

```sh
$ yarn gasReport
```

### Deploy contract to netowrk (requires Mnemonic and infura API key)

```sh
$ yarn deploy --network <network>
```

### Validate a contract with etherscan (requires API ke)

```sh
$ yarn verify --network <network>
```
