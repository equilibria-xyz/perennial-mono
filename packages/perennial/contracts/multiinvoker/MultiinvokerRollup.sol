pragma solidity ^0.8.0;

import "./Multiinvoker.sol";

/// @notice JUST A SCRATCHPAD, DO NOT READ
contract MultiInvokerRollup is MultiInvoker {

    // type 0 0000 (address, product, uint)
    // type 1 0001 (product, uint)
    // type 2 0010 (address, uint)
    // type 3 0011 (product, packed uint[])

    /// @dev JUST SCRATCHPADDING RN, DO NOT READ !!!
    fallback (bytes calldata input) external {
        uint ptr;
        uint len = input.length;

        for(ptr; ptr < len;) {
            uint action = input[ptr:ptr+1];
            
            // solidity doesn't like evaluating bytes as enums :/ 

            // PerennialAction.Deposit 
            if(action == 0) {
                address account; IProduct product; UFixed18 amount;

                // decode calldata for first action and shift pointer to next action
                (account, product, amount, ptr) = decodeTypes1(input, ptr);

                // call function here @todo change to depositTo to internal  

            } // else if ... etc ... etc .. etc
            
    
        }
    }

    function decodeTypes1(bytes calldata input, uint ptr) private returns (address user, IProduct product, uint amount, uint ptr) {
        (ptr, user) = decodeUser(input, ptr);
        (ptr, product) = decodeProduct(input, ptr);
        (ptr, amount) = decodeAmount(input, ptr);
    }
    
    function decodeUser(bytes calldata input, uint ptr) private returns (address, uint) {

    }

    function decodeProduct(bytes calldata input, uint ptr) private returns (address, ptr) {

    } 

    function decodeUint(bytes calldata input, uint ptr) private returns (uint, uint) {

    }

    function decodeUintArray(bytes calldata input, uint ptr) private returns (uint[], uint) {

    }
}