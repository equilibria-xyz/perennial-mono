# Solidity Template

Uses

- [Hardhat](https://github.com/nomiclabs/hardhat): compile and run the smart contracts on a local development network
- [TypeChain](https://github.com/ethereum-ts/TypeChain): generate TypeScript types for smart contracts
- [Ethers](https://github.com/ethers-io/ethers.js/): Ethereum library and wallet implementation
- [Waffle](https://github.com/EthWorks/Waffle): tooling for writing comprehensive smart contract tests
- [Solhint](https://github.com/protofire/solhint): Solidity linter
- [Prettier Plugin Solidity](https://github.com/prettier-solidity/prettier-plugin-solidity): code formatter

This is a GitHub template, which means you can reuse it as many times as you want. You can do that by clicking the "Use this
template" button at the top of the page.

## Usage

### Pre Requisites

This repo works best with Node.js v16.x.x, this is preconfigured for users of [asdf](https://asdf-vm.com/).

Before running any command, make sure to install dependencies:

```sh
$ yarn
```

### Compile

Compile the smart contracts with Hardhat:

```sh
$ yarn compile
```

This also generates the Typechain types

### Test

Run the Mocha tests:

```sh
$ yarn test
```

To run tests against a Mainnet fork, set your `ALCHEMY_KEY` in `.env` and run

```sh
$ yarn test-integration
```

### Gas Report
To get a gas report based on unit test calls:

```sh
$ yarn gasReport
```

### Deploy contract to netowrk (requires Mnemonic and infura API key)

```
npx hardhat run --network rinkeby ./scripts/deploy.ts
```

### Validate a contract with etherscan (requires API key)

```
npx hardhat verify --network <network> <DEPLOYED_CONTRACT_ADDRESS> "Constructor argument 1"
```

### Added plugins

- Contract Sizer [hardhat-contract-sizer](https://github.com/ItsNickBarry/hardhat-contract-sizer)
- Gas reporter [hardhat-gas-reporter](https://hardhat.org/plugins/hardhat-gas-reporter.html)
- Etherscan [hardhat-etherscan](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html)
