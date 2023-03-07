pragma solidity ^0.8.0;

import "./MultiInvoker.sol";

// import "forge-std/Test.sol";

contract MultiInvokerRollup is MultiInvoker {

    event AddressAddedToCache(address indexed addr, uint256 nonce);

    uint256 public addressNonce;
    mapping(uint => address) public addressCache;
    mapping(address => uint) public addressNonces;

    
    constructor(
        Token6 usdc_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        IController controller_
    ) MultiInvoker(
        usdc_,
        batcher_,
        reserve_,
        controller_
    ) { }

    /// @dev fallback eliminates the need to include function sig
    fallback (bytes calldata input) external returns (bytes memory) {
        decodeFallbackAndInvoke(input);
    }

    /// @dev this function serves (@todo will serve*) exactly the same as invoke(Invocation[] memory invocations),
    /// but includes all the logic to handle the highly packed calldata
    function decodeFallbackAndInvoke(bytes calldata input) private {
        uint ptr;
        uint len = input.length;
    
        for(ptr; ptr < len;) {
            uint8 action = toUint8(input[ptr:ptr+1]);
            ptr += 1;

            // solidity doesn't like evaluating bytes as enums :/ 
            if(action == 1) { // DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount, ptr) = decodeAddressAddressAmount(input, ptr);

                depositTo(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount, ptr) = decodeAddressAddressAmount(input, ptr);

                collateral.withdrawFrom(msg.sender, receiver, IProduct(product), amount);
            } else if (action == 3) { // OPEN_TAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = decodeAddressAmount(input, ptr);

                IProduct(product).openTakeFor(msg.sender, amount);  
            } else if (action == 4) { // CLOSE_TAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = decodeAddressAmount(input, ptr);

                IProduct(product).closeTakeFor(msg.sender, amount);
            } else if (action == 5) { // OPEN_MAKE 
                address product; UFixed18 amount;
                (product, amount, ptr) = decodeAddressAmount(input, ptr);

                IProduct(product).openMakeFor(msg.sender, amount);
            } else if (action == 6) { // CLOSE_MAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = decodeAddressAmount(input, ptr);

                IProduct(product).closeMakeFor(msg.sender, amount);
            } else if (action == 7) { // CLAIM 
                address product; uint256[] memory programIds;
                (product, programIds, ptr) = decodeProductPrograms(input, ptr);

                controller.incentivizer().claimFor(msg.sender, IProduct(product), programIds);
            } else if (action == 8) { // WRAP 
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = decodeAddressAmount(input, ptr);

                wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = decodeAddressAmount(input, ptr);

                unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount, ptr) = decodeAddressAddressAmount(input, ptr);
                
               wrapAndDeposit(account, IProduct(product), amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount, ptr) = decodeAddressAddressAmount(input, ptr);

                withdrawAndUnwrap(receiver, IProduct(product), amount);
            } else if (action == 12) { // VAULT_DEPOSIT
                address depositer; address vault; UFixed18 amount;
                (depositer, vault, amount, ptr) = decodeAddressAddressAmount(input, ptr);

                vaultDeposit(depositer, IPerennialVault(vault), amount);
            } else if (action == 13) { // VAULT_REDEEM
                address vault; UFixed18 shares;
                (vault, shares, ptr) = decodeAddressAmount(input, ptr);

                IPerennialVault(vault).redeem(shares, msg.sender);
            } else if (action == 14) { // VAULT_CLAIM
                address owner; address vault;
                (owner, vault, ptr) = decodeAddressAddress(input, ptr);

                IPerennialVault(vault).claim(owner);
            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                address account; address vault; UFixed18 amount;
                (account, vault, amount, ptr) = decodeAddressAddressAmount(input, ptr);

                vaultWrapAndDeposit(account, IPerennialVault(vault), amount);
            }
        }
    }

    /// Example Calldata Structure
    /// let ptr
    /// [ptr(userLen), ptr+1:userLen(user registry # OR 20 byte address if userLen == 0)] => address user 
    /// ptr += (userLen OR 20) + 1
    /// [ptr(prodcutLen), ptr+1:productLen(product registry # OR 20 byte address if prdoctLen == 0)] => address product
    /// ptr += (prodcutLen OR 20) + 1
    /// [ptr(amountLen), ptr:amountLen] => uint256 amount 


    // ARGUMENT TYPE DECODING //

    function decodeAddressAddressAmount(bytes calldata input, uint ptr) private returns (address addr1, address addr2, UFixed18 amount, uint) {
        (addr1, ptr) = decodeAddress(input, ptr);
        (addr2, ptr) = decodeAddress(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return (addr1, addr2, amount, ptr);
    }

    function decodeAddressAmount(bytes calldata input, uint ptr) private returns (address addr1, UFixed18 amount, uint) {
        (addr1, ptr) = decodeAddress(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return(addr1, UFixed18(amount), ptr);
    }

    function decodeProductPrograms(bytes calldata input, uint ptr) private returns(address product, uint256[] memory programs, uint) {
        (product, ptr) = decodeAddress(input, ptr);
        (programs, ptr) = decodeUintArray(input, ptr);

        return(product, programs, ptr);
    }

    function decodeAddressAddress(bytes calldata input, uint ptr) private returns(address addr1, address addr2, uint) {
        (addr1, ptr) = decodeAddress(input, ptr);
        (addr2, ptr) = decodeAddress(input, ptr);

        return (addr1, addr2, ptr);
    }


    // INDIVIDUAL TYPE DECODING //

     function decodeAmountUFixed18(bytes calldata input, uint ptr) private returns (UFixed18 result, uint) {
        uint temp;
        (temp, ptr) = decodeUint(input, ptr);

        return(UFixed18.wrap(temp), ptr);
    }

    function decodeUint(bytes calldata input, uint ptr) private returns (uint result, uint) {
        uint8 len = toUint8(input[ptr:ptr+1]);
        ++ptr;

        result = bytesToUint(input[ptr:ptr+len]);
        ptr += len;

        return (result, ptr);
    }

 

    // function decodeUFixed18Array(bytes calldata input, uint ptr) private returns (UFixed18[] memory, uint) {
    //     uint8 arrayLen = toUint8(input[ptr:ptr+1]);
    //     ++ptr;

    //     UFixed18[] memory result = new UFixed18[](arrayLen);
    //     uint count = 0;
    //     for(;count < arrayLen;) {
    //         UFixed18 currUint;

    //         (currUint, ptr) = decodeAmountUFixed18(input, ptr);
            
    //         result[count] = currUint;

    //         ++count;
    //     }

    //     return (result, ptr);
    // }


    function decodeUintArray(bytes calldata input, uint ptr) private returns (uint256[] memory, uint) {
        uint8 arrayLen = toUint8(input[ptr:ptr+1]);
        ++ptr;

        uint256[] memory result = new uint256[](arrayLen);

        uint count = 0;
        for(;count < arrayLen;) {
            uint currUint;

            (currUint, ptr) = decodeUint(input, ptr);

            result[count] = currUint;

            ++count;
        }
        return (result, ptr);
    }

    function decodeAddress(bytes calldata input, uint ptr) private returns(address addr, uint) {
        uint8 addrLen = toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // user is new to registry, add next 20 bytes as address to registry and return address
        if(addrLen == 0) {
            addr = bytesToAddress(input[ptr:ptr+20]);
            ptr += 20;

            setAddressCache(addr);

        } else {
            uint addrNonceLookup = bytesToUint(input[ptr:ptr+addrLen]);
            ptr += addrLen;

            addr = getAddressCacheSafe(addrNonceLookup);
        }

        return (addr, ptr);
    }

    function setAddressCache(address addr) private {
        ++addressNonce;
        addressCache[addressNonce] = addr;
        addressNonces[addr] = addressNonce;
        emit AddressAddedToCache(addr, addressNonce);
    }

    function getAddressCacheSafe(uint nonce) public returns (address addr){
        addr = addressCache[nonce];
        if(addr == address(0x0)) revert("Bad calldata, user !cached");
    }

    // HELPER FUNCTIONS //
    
    // Unchecked force of 20 bytes into address
    // This is called in decodeAccount and decodeProduct which both only pass 20 byte slices 
    function bytesToAddress(bytes memory input) private pure returns (address addr) {
        assembly {
            addr := mload(add(input, 20))
        } 
    }

    // Unchecked implementation of GNSPS' standard BytesLib.sol
    function toUint8(bytes memory _b) internal pure returns (uint8 res) {
        assembly {
            res := mload(add(_b, 0x1))
        }
    }

    // loads arbitrarily-sized byte array into a uint unchecked
    function bytesToUint(bytes memory _b) private returns(uint256 res) {
        uint len = _b.length;

        assembly {
            res := mload(add(_b, 0x20))
        }

        if(res == 0x20) {
            return 0;
        }

        // readable right shift to change right padding of mload to left padding
        res >>= 256 - (len * 8);
    }

}