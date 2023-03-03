pragma solidity ^0.8.0;

import "./MultiInvoker.sol";

// import "forge-std/Test.sol";

contract MultiInvokerRollup is MultiInvoker {
    using UFixed18Lib for uint256;

    event AccountAddedToCache(address indexed account, uint256 nonce);
    event ContractAddedToCache(address indexed product, uint256 nonce);

    uint256 public accountNonce;
    mapping(uint => address) public accountCache;
    mapping(address => uint) public accountNonces;

    uint256 public contractNonce;
    mapping(uint => address) public contractCache;
    mapping(address => uint) public contractNonces; 
    
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
                address account; IProduct product; UFixed18 amount;
                (account, product, amount, ptr) = decodeAccountProductAmount(input, ptr);

                depositTo(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver; IProduct product; UFixed18 amount;
                (receiver, product, amount, ptr) = decodeAccountProductAmount(input, ptr);

                collateral.withdrawFrom(msg.sender, receiver, product, amount);
            } else if (action == 3) { // OPEN_TAKE
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.openTakeFor(msg.sender, amount);  
            } else if (action == 4) { // CLOSE_TAKE
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.closeTakeFor(msg.sender, amount);
            } else if (action == 5) { // OPEN_MAKE 
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.openMakeFor(msg.sender, amount);
            } else if (action == 6) { // CLOSE_MAKE
                IProduct product; UFixed18 amount;
                (product, amount, ptr) = decodeProductAmount(input, ptr);

                product.closeMakeFor(msg.sender, amount);
            } else if (action == 7) { // CLAIM 
                IProduct product; uint256[] memory programIds;
                (product, programIds, ptr) = decodeProductPrograms(input, ptr);

                controller.incentivizer().claimFor(msg.sender, product, programIds);
            } else if (action == 8) { // WRAP 
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = decodeAccountAmount(input, ptr);

                wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver; UFixed18 amount;
                (receiver, amount, ptr) = decodeAccountAmount(input, ptr);

                unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account; IProduct product; UFixed18 amount;
                (account, product, amount, ptr) = decodeAccountProductAmount(input, ptr);
                
               wrapAndDeposit(account, product, amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver; IProduct product; UFixed18 amount;
                (receiver, product, amount, ptr) = decodeAccountProductAmount(input, ptr);

                withdrawAndUnwrap(receiver, product, amount);
            } else if (action == 12) { // VAULT_DEPOSIT
                address depositer; IPerennialVault vault; UFixed18 amount;
                (depositer, vault, amount, ptr) = decodeAccountVaultAmount(input, ptr);

                vaultDeposit(depositer, vault, amount);
            } else if (action == 13) { // VAULT_REDEEM
                IPerennialVault vault; UFixed18 shares;
                (vault, shares, ptr) = decodeVaultAmount(input, ptr);

                vault.redeem(shares, msg.sender);
            } else if (action == 14) { // VAULT_CLAIM
                address owner; IPerennialVault vault;
                (owner, vault, ptr) = decodeAccountContract(input, ptr);

                vault.claim(owner);
            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                address account; IPerennialVault vault; UFixed18 amount;
                (account, vault, amount, ptr) = decodeAccountVaultAmount(input, ptr);

                vaultWrapAndDeposit(account, vault, amount);
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

    function decodeAccountProductAmount(bytes calldata input, uint ptr) private returns (address account, IProduct product, UFixed18 amount, uint) {
        (account, ptr) = decodeAccount(input, ptr);
        (product, ptr) = decodeProduct(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return (account, product, amount, ptr);
    }

    function decodeAccountVaultAmount(bytes calldata input, uint ptr) private returns (address account, IPerennialVault vault, UFixed18 amount, uint) {
        address temp;

        (account, ptr) = decodeAccount(input, ptr);
        (temp, ptr) = decodeContract(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return (account, IPerennialVault(temp), amount, ptr);
    }

    function decodeProductPrograms(bytes calldata input, uint ptr) private returns(IProduct product, uint256[] memory programs, uint) {
        (product, ptr) = decodeProduct(input, ptr);
        (programs, ptr) = decodeUintArray(input, ptr);

        return(product, programs, ptr);
    }

    function decodeProductAmount(bytes calldata input, uint ptr) private returns (IProduct product, UFixed18 amount, uint) {
        (product, ptr) = decodeProduct(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return(product, UFixed18(amount), ptr);
    }

    function decodeVaultAmount(bytes calldata input, uint ptr) private returns (IPerennialVault vault, UFixed18 amount, uint) {
        address temp;

        (temp, ptr) = decodeContract(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return(IPerennialVault(temp), amount, ptr);
    }

    function decodeAccountContract(bytes calldata input, uint ptr) private returns(address account, IPerennialVault vault, uint) {
        address temp;

        (account, ptr) = decodeAccount(input, ptr);
        (temp, ptr) = decodeContract(input, ptr);

        return (account, IPerennialVault(temp), ptr);
    }

    function decodeAccountAmount(bytes calldata input, uint ptr) private returns(address account, UFixed18 amount, uint) {
        (account, ptr) = decodeAccount(input, ptr);
        (amount, ptr) = decodeAmountUFixed18(input, ptr);

        return(account, amount, ptr);
    }

    // INDIVIDUAL TYPE DECODING //

    function decodeAmountUFixed18(bytes calldata input, uint ptr) private returns (UFixed18 result, uint) {
        uint8 len = toUint8(input[ptr:ptr+1]);
        ptr += 1; 
        
        result = UFixed18.wrap(bytesToUint(input[ptr:ptr+len]));
        ptr += len;

        return (result, ptr);
    }

    function decodeUint(bytes calldata input, uint ptr) private returns (uint result, uint) {
        uint8 len = toUint8(input[ptr:ptr+1]);
        ++ptr;

        result = bytesToUint(input[ptr:ptr+len]);
        ptr += len;

        return (result, ptr);
    }

 

    function decodeUFixed18Array(bytes calldata input, uint ptr) private returns (UFixed18[] memory, uint) {
        uint8 arrayLen = toUint8(input[ptr:ptr+1]);
        ++ptr;

        UFixed18[] memory result = new UFixed18[](arrayLen);
        uint count = 0;
        for(;count < arrayLen;) {
            UFixed18 currUint;

            (currUint, ptr) = decodeAmountUFixed18(input, ptr);
            
            result[count] = currUint;

            ++count;
        }

        return (result, ptr);
    }


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



    function decodeAccount(bytes calldata input, uint ptr) private returns(address account, uint) {
        uint8 accountLen = toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // user is new to registry, add next 20 bytes as address to registry and return address
        if(accountLen == 0) {
            account = bytesToAddress(input[ptr:ptr+20]);
            ptr += 20;

            setAccountCache(account);

        } else {
            uint accountNonceLookup = bytesToUint(input[ptr:ptr+accountLen]);
            ptr += accountLen;

            account = getAccountCacheSafe(accountNonceLookup);
        }

        return (account, ptr);
    }

    function decodeProduct(bytes calldata input, uint ptr) private returns(IProduct product, uint) {
        uint8 productLen = toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // product is new to registry, add next 20 bytes as address to registry and return address
        if(productLen == 0) {
            product = IProduct(bytesToAddress(input[ptr:ptr+20]));
            ptr += 20;

            setContractCache(address(product));
            
        } else {
            uint productNonceLookup = bytesToUint(input[ptr:ptr+productLen]);
            ptr += productLen;

            product = IProduct(getContractCacheSafe(productNonceLookup));
        }

        return (product, ptr);
    }

    function decodeContract(bytes calldata input, uint ptr) private returns(address _contract, uint) {
        uint8 contractLen = toUint8(input[ptr:ptr+1]);
        ptr += 1;

        // contract is new to registry, add next 20 bytes as address to registry and return address
        if(contractLen == 0) {
            _contract = bytesToAddress(input[ptr:ptr+20]);
            ptr += 20;

            setContractCache(address(_contract));
            
        } else {
            uint contractNonceLookup = bytesToUint(input[ptr:ptr+contractLen]);
            ptr += contractLen;

            _contract = getContractCacheSafe(contractNonceLookup);
        }

        return (_contract, ptr);

    }

    function setAccountCache(address account) private {
        ++accountNonce;
        accountCache[accountNonce] = account;
        accountNonces[account] = accountNonce;
        emit AccountAddedToCache(account, accountNonce);
    }

    function getAccountCacheSafe(uint nonce) public returns (address account){
        account = accountCache[nonce];
        if(account == address(0x0)) revert("Bad calldata, user !cached");
    }

    function setContractCache(address _contract) private {
        ++contractNonce;
        contractCache[contractNonce] = _contract;
        contractNonces[_contract] = contractNonce;
        emit ContractAddedToCache(_contract, contractNonce);
    }

    function getContractCacheSafe(uint nonce) public view returns(address _contract) {
        _contract = contractCache[nonce];
        if(_contract == address(0x0)) revert("Bad calldata, contract not found in cache");
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
    function toUint8(bytes memory _bytes) internal pure returns (uint8 res) {
        assembly {
            res := mload(add(_bytes, 0x1))
        }
    }

    function toUint8(bytes memory _bytes, uint256 _start) internal pure returns (uint8 res) {
        require(_bytes.length >= _start + 1 , "toUint8_outOfBounds");
        uint8 tempUint;

        assembly {
            tempUint := mload(add(add(_bytes, 0x1), _start))
        }

        return tempUint;
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