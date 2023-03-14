pragma solidity ^0.8.15;

import "./MultiInvoker.sol";

/// @title A calldata-optimized implementation of the Perennial MultiInvoker 
/// @notice Retains same functionality and `invoke` entry point from inherited MultiInvoker
contract MultiInvokerRollup is MultiInvoker {

    event AddressAddedToCache(address indexed addr, uint256 nonce);

    /// @dev reverts when address cache is relied on before a user / contract has been registered in state
    /// if thrown, pass the bytes'00' (0 length) + the full 20 byte address instead of the length + index, 
    /// can parse the events or mapping below to get the newly added cache index
    error MultiInvokerRollupInvalidCalldataError();

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

    /// @dev fallback eliminates the need to include function sig in calldata
    fallback (bytes calldata input) external returns (bytes memory){
        _decodeFallbackAndInvoke(input);
        return "";
    }

    /// @dev this function serves exactly the same as invoke(Invocation[] memory invocations),
    /// but includes all the logic to handle the highly packed calldata
    function _decodeFallbackAndInvoke(bytes calldata input) private {
        uint ptr;
        uint len = input.length;
    
        for (ptr; ptr < len;) {
            uint8 action = _toUint8(input[ptr:ptr+1]);
            ptr += 1;

            // solidity doesn't like evaluating bytes as enums :/ 
            if (action == 1) { // DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _depositTo(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _withdrawFrom(receiver, IProduct(product), amount);
            } else if (action == 3) { // OPEN_TAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _openTakeFor(IProduct(product), amount);  
            } else if (action == 4) { // CLOSE_TAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _closeTakeFor(IProduct(product), amount);
            } else if (action == 5) { // OPEN_MAKE 
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _openMakeFor(IProduct(product), amount);
            } else if (action == 6) { // CLOSE_MAKE
                address product; UFixed18 amount;
                (product, amount, ptr) = _decodeAddressAmount(input, ptr);

                _closeMakeFor(IProduct(product), amount);
            } else if (action == 7) { // CLAIM 
                address product; uint256[] memory programIds;
                (product, programIds, ptr) = _decodeProductPrograms(input, ptr);

                _claimFor(IProduct(product), programIds);
            } else if (action == 8) { // WRAP 
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = _decodeAddressAmount(input, ptr);

                _wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = _decodeAddressAmount(input, ptr);

                _unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);
                
               _wrapAndDeposit(account, IProduct(product), amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _withdrawAndUnwrap(receiver, IProduct(product), amount);
            } else if (action == 12) { // VAULT_DEPOSIT
                address depositer; address vault; UFixed18 amount;
                (depositer, vault, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _vaultDeposit(depositer, IPerennialVault(vault), amount);
            } else if (action == 13) { // VAULT_REDEEM
                address vault; UFixed18 shares;
                (vault, shares, ptr) = _decodeAddressAmount(input, ptr);

                _vaultRedeem(IPerennialVault(vault), shares);
            } else if (action == 14) { // VAULT_CLAIM
                address owner; address vault;
                (owner, vault, ptr) = _decodeAddressAddress(input, ptr);

                _vaultClaim(IPerennialVault(vault), owner);
            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                address account; address vault; UFixed18 amount;
                (account, vault, amount, ptr) = _decodeAddressAddressAmount(input, ptr);

                _vaultWrapAndDeposit(account, IPerennialVault(vault), amount);
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

    function _decodeAddressAddressAmount(bytes calldata input, uint ptr) private returns (address addr1, address addr2, UFixed18 amount, uint) {
        (addr1, ptr) = _decodeAddress(input, ptr);
        (addr2, ptr) = _decodeAddress(input, ptr);
        (amount, ptr) = _decodeAmountUFixed18(input, ptr);

        return (addr1, addr2, amount, ptr);
    }

    function _decodeAddressAmount(bytes calldata input, uint ptr) private returns (address addr1, UFixed18 amount, uint) {
        (addr1, ptr) = _decodeAddress(input, ptr);
        (amount, ptr) = _decodeAmountUFixed18(input, ptr);

        return(addr1, amount, ptr);
    }

    function _decodeProductPrograms(bytes calldata input, uint ptr) private returns(address product, uint256[] memory programs, uint) {
        (product, ptr) = _decodeAddress(input, ptr);
        (programs, ptr) = _decodeUintArray(input, ptr);

        return(product, programs, ptr);
    }

    function _decodeAddressAddress(bytes calldata input, uint ptr) private returns(address addr1, address addr2, uint) {
        (addr1, ptr) = _decodeAddress(input, ptr);
        (addr2, ptr) = _decodeAddress(input, ptr);

        return (addr1, addr2, ptr);
    }


    // INDIVIDUAL TYPE DECODING //

    /// @dev 
     function _decodeAmountUFixed18(bytes calldata input, uint ptr) private returns (UFixed18 result, uint) {
        uint temp;
        (temp, ptr) = _decodeUint(input, ptr);

        return(UFixed18.wrap(temp), ptr);
    }

    /// @dev 
    function _decodeUint(bytes calldata input, uint ptr) private returns (uint result, uint) {
        uint8 len = _toUint8(input[ptr:ptr+1]);
        ++ptr;

        result = _bytesToUint(input[ptr:ptr+len]);
        ptr += len;

        return (result, ptr);
    }

    /// @dev 
    function _decodeUintArray(bytes calldata input, uint ptr) private returns (uint256[] memory, uint) {
        uint8 arrayLen = _toUint8(input[ptr:ptr+1]);
        ++ptr;

        uint256[] memory result = new uint256[](arrayLen);

        uint count = 0;
        for (;count < arrayLen;) {
            uint currUint;

            (currUint, ptr) = _decodeUint(input, ptr);

            result[count] = currUint;

            ++count;
        }
        return (result, ptr);
    }

    /// @dev decodes an address from calldata if length == 0, storing next 20 bytes as address to cache 
    /// else loading address from uint cache index
    /// @param input full calldata
    /// @param ptr start index of current address being decoded 
    function _decodeAddress(bytes calldata input, uint ptr) private returns(address addr, uint) {
        uint8 addrLen = _toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (addrLen == 0) {
            addr = _bytesToAddress(input[ptr:ptr+20]);
            ptr += 20;

            _setAddressCache(addr);

        } else {
            uint addrNonceLookup = _bytesToUint(input[ptr:ptr+addrLen]);
            ptr += addrLen;

            addr = _getAddressCacheSafe(addrNonceLookup);
        }

        return (addr, ptr);
    }

    /// 
    function _setAddressCache(address addr) private {
        ++addressNonce;
        addressCache[addressNonce] = addr;
        addressNonces[addr] = addressNonce;
        emit AddressAddedToCache(addr, addressNonce);
    }

    /// @dev there is something wrong with the calldata if it uses cache before caching address
    function _getAddressCacheSafe(uint nonce) public returns (address addr){
        addr = addressCache[nonce];
        if (addr == address(0)) revert MultiInvokerRollupInvalidCalldataError();
    }

    // HELPER FUNCTIONS //
    
    /// @dev Unchecked force of 20 bytes into address
    /// This is called in decodeAccount and decodeProduct which both only pass 20 byte slices 
    function _bytesToAddress(bytes memory input) private pure returns (address addr) {
        assembly {
            addr := mload(add(input, 20))
        } 
    }

    /// @dev Unchecked implementation of GNSPS' standard BytesLib.sol
    function _toUint8(bytes memory _b) internal pure returns (uint8 res) {
        assembly {
            res := mload(add(_b, 0x1))
        }
    }

    /// @dev Loads arbitrarily-sized byte array into a uint unchecked
    function _bytesToUint(bytes memory _b) private returns(uint256 res) {
        uint len = _b.length;

        assembly {
            res := mload(add(_b, 0x20))
        }

        if (res == 0x20) {
            return 0;
        }

        // readable right shift to change right padding of mload to left padding
        res >>= 256 - (len * 8);
    }
}