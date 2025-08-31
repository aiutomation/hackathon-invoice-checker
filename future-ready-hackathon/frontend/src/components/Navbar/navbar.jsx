import React from 'react'
import './navbar.css'

const Navbar = () => {
    return (
        <div className='navbar'>
            <div className='brand'>PayCheck</div>
            <ul>
                <li>Home</li>
                <li>Features</li>
                <li>Why Us</li>
                {/* <li>Pricing</li> */}
                {/* <li>Resources</li> */}
            </ul>
            <div className='actions'>
                <button className='link-btn'>Login</button>
                <button className='primary-btn'>Sign Up</button>
            </div>
        </div>
    )
}


export default Navbar