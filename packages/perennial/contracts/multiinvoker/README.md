## Rollup gas optimizations for multiinvoker

Rationale: Because rollup gas is mostly determined by calldata size/makeup and multiinvoker is the main entry point for user calls to the protocol, we would want to optimize the entry of these functions as much as possible rather than leaving it the same as on L1s 


### 1) Protecting logic
- instead of altering the core codebase, we can inherit the base Multiinvoker and have calls enter a fallback with highly packed calldata (only change would be to make action fns internal instead of private)

```
contract MultiInvokerRollup is MultiInvoker {
    fallback(bytes calldata input) external {}
}

```

- if lack of upgradeability is a concern for stuff like address cache max size (see @todo ) we can treat MultiInvokerRollup as a proxy instead 

### 2) Replacing `invoke(Invocation[] calldata invocations)`
- the fallback function does the multicall job of the invoke, so it would be redundant to use over calling the action fns directly 

- the fallback would have the same loop as invoke, but 1) the calldata would be tightly packed by the caller / frontend and 2) custom decoding fns would be used instead of `abi.decode`


### 3) Scope of decoding
- currently the multiinvoker has 4 types of calldata values present across the 12 different actions present
  
    1) (address, product, uint)
    2) (product, uint)
    3) (address, uint)
    4) (product, packed uint[])

- the individual encoding / decoding for each arg type would go as follows 

    #### 4.1) user addr caching 
    #### 4.2) product addr caching
    #### 4.3) uint256
         
    #### 4.4) uint256[]

### 4) Potential upgradeability 
Given the # of potential users and products could be near infinite, it may be a bad idea to set a cap much closer to 0 than 2^256 