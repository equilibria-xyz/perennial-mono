# General concerns

# Rollup Optimizations


# External user-facing functions

1) forwarder/Forwarder.sol

```
   function wrapAndDeposit(
        address account, 
        IProduct product,
        UFixed18 amount
    ) external {}
```
!! LEAVE FN UNTOUCHED, PARSE ENCODED INPUTS IN FALLBACK !!!
   - this allows for normal interactin with the protocol without changing core code
  
`account` - 
  - mapping(small uint => account) registry 
  - concerns: 
    - bad ux / too much tech debt to keep track of and or have user add themself to registry?
    - would an account registry safe? 
    - how small of a uint can fit max realistic # of users without dos risk? 
  
`product` - address can be included in registry, decide on realistic max # of product markets
  - concerns:
    - unclear how difficult to determine max # of products if permissionless
  
`amount` - abi.encodePacked only packs data in word down to the max size of its type  
  - UFixed18 == uint256 ... 32 bytes -> uint256 encoded is 32 bytes. 0s cost less but not negligible gas on rollups



Definite improvements:
  - if forwarder is not being inherited (only 1 fn selector), use a fallback with hardcoded selector "wrapAndDeposit(address,address,uint256)"
   ```
   fallback (bytes calldata input) external {
      // parse input
      // call wrapAndDeposit normally
   }
   ```
  - custom encoding/decoding for amount
  
Result of definite improvements: calldata ~ < 1/2 size


2) collateral/Collateral.sol 

```
function withdrawTo(address receiver, IProduct product, UFixed18 amount) external {}
```

same as `wrapAndDeposit` in Forwarder.sol above


