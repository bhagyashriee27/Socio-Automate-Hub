from flask import Flask, request, jsonify, session
import mysql.connector
import re
from datetime import datetime, timedelta
import pytz
import uuid
import os
from dotenv import load_dotenv
# Added imports for Google Drive upload
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError
from datetime import datetime, timedelta, date  # Add 'date' here
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import random
import time

import json
from datetime import datetime



import os
import uuid
from flask import request, jsonify
from werkzeug.utils import secure_filename
import threading
from collections import defaultdict
# Add these global variables for chunk management
upload_chunks = defaultdict(list)
upload_status = {}

# done 👌👌👌👌 done wait

# Store OTPs temporarily (in production, use Redis or database)
otp_storage = {}

SCOPES = ["https://www.googleapis.com/auth/drive"]  # For Drive access
# Load environment variables from .env file
load_dotenv()

# Database configuration from environment variables
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "database": os.getenv("DB_DATABASE"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT"))
}
TIMEZONE = pytz.timezone('Asia/Kolkata')

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secure-random-key-1234567890'  # Replace with a secure random key
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=1)  # Sessions last 1 day

# --- Helper Functions ---
def get_db_connection():
    """Establish connection to the MySQL database."""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def validate_email(email):
    """Validate email format."""
    return re.match(r"[^@]+@[^@]+\.[^@]+", email) is not None

def time_to_timedelta(time_str):
    """Convert time string (HH:MM:SS) to timedelta for database storage."""
    if not time_str:
        return None
    try:
        t = datetime.strptime(time_str, "%H:%M:%S")
        return timedelta(hours=t.hour, minutes=t.minute, seconds=t.second)
    except ValueError:
        return None

def get_user_id_from_email(email):
    """Fetch user_id for a given email."""
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT Id FROM user WHERE email = %s", (email,))
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        return result[0] if result else None
    except mysql.connector.Error as e:
        print(f"ERROR: Failed to fetch user_id: {str(e)}")
        conn.close()
        return None

def serialize_timedelta(obj):
    """Convert timedelta or datetime objects to JSON-serializable strings."""
    if isinstance(obj, timedelta):
        total_seconds = int(obj.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02}:{minutes:02}:{seconds:02}"
    if isinstance(obj, datetime):
        return obj.strftime('%Y-%m-%d %H:%M:%S')
    return str(obj)

@app.route('/forgot-password/send-otp', methods=['POST'])
def send_password_reset_otp():
    """Send OTP to user's email for password reset."""
    data = request.get_json()
    email = data.get('email')
    phone_number = data.get('phone_number')

    # Validation
    if not email or not phone_number:
        return jsonify({"error": "Email and phone number are required"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        # Verify user exists with matching email and phone number
        cursor.execute(
            "SELECT Id, Name FROM user WHERE email = %s AND phone_number = %s", 
            (email, phone_number)
        )
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if not user:
            return jsonify({"error": "No user found with provided email and phone number"}), 404

        # Generate 6-digit OTP
        otp = str(random.randint(100000, 999999))
        
        # Store OTP with timestamp (valid for 10 minutes)
        otp_storage[email] = {
            'otp': otp,
            'timestamp': time.time(),
            'phone_number': phone_number
        }

        # Send OTP via email
        send_otp_email(email, otp, user['Name'])

        return jsonify({"message": "OTP sent successfully"}), 200

    except mysql.connector.Error as e:
        if conn:
            conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"Failed to send OTP: {str(e)}"}), 500

@app.route('/forgot-password/verify-otp', methods=['POST'])
def verify_password_reset_otp():
    """Verify OTP for password reset."""
    data = request.get_json()
    email = data.get('email')
    phone_number = data.get('phone_number')
    otp = data.get('otp')

    # Validation
    if not email or not phone_number or not otp:
        return jsonify({"error": "Email, phone number, and OTP are required"}), 400

    # Check if OTP exists and is valid
    if email not in otp_storage:
        return jsonify({"error": "OTP not found or expired"}), 400

    stored_data = otp_storage[email]
    
    # Check if OTP is expired (10 minutes)
    if time.time() - stored_data['timestamp'] > 600:  # 10 minutes
        del otp_storage[email]
        return jsonify({"error": "OTP has expired"}), 400

    # Verify phone number matches
    if stored_data['phone_number'] != phone_number:
        return jsonify({"error": "Invalid phone number"}), 400

    # Verify OTP
    if stored_data['otp'] != otp:
        return jsonify({"error": "Invalid OTP"}), 400

    # Mark OTP as verified
    otp_storage[email]['verified'] = True

    return jsonify({"message": "OTP verified successfully"}), 200

@app.route('/forgot-password/reset', methods=['POST'])
def reset_password():
    """Reset user password after OTP verification."""
    data = request.get_json()
    email = data.get('email')
    phone_number = data.get('phone_number')
    otp = data.get('otp')
    new_password = data.get('new_password')

    # Validation
    if not email or not phone_number or not otp or not new_password:
        return jsonify({"error": "All fields are required"}), 400

    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long"}), 400

    # Verify OTP first
    if email not in otp_storage:
        return jsonify({"error": "OTP verification required"}), 400

    stored_data = otp_storage[email]
    
    if not stored_data.get('verified'):
        return jsonify({"error": "OTP not verified"}), 400

    # Check if OTP is expired
    if time.time() - stored_data['timestamp'] > 600:  # 10 minutes
        del otp_storage[email]
        return jsonify({"error": "OTP session expired"}), 400

    # Verify OTP matches
    if stored_data['otp'] != otp or stored_data['phone_number'] != phone_number:
        return jsonify({"error": "Invalid OTP or phone number"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Update user password
        cursor.execute(
            "UPDATE user SET passward = %s WHERE email = %s AND phone_number = %s",
            (new_password, email, phone_number)
        )
        
        if cursor.rowcount == 0:
            cursor.close()
            conn.close()
            return jsonify({"error": "User not found"}), 404

        conn.commit()
        cursor.close()
        conn.close()

        # Clear OTP after successful password reset
        del otp_storage[email]

        return jsonify({"message": "Password reset successfully"}), 200

    except mysql.connector.Error as e:
        if conn:
            conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

def send_otp_email(email: str, otp: str, user_name: str):
    """Send OTP email to user from Socio-Automate Hub."""
    try:
        # Email configuration
        smtp_server = "smtp.gmail.com"
        smtp_port = 587
        sender_email = "otpsender191@gmail.com"
        sender_password = "euwd ghss ahwy rblq"  # Your app password

        # Create message
        message = MIMEMultipart()
        message["From"] = f"Socio-Automate Hub <{sender_email}>"
        message["To"] = email
        message["Subject"] = "Password Reset OTP - Socio-Automate Hub"

        # Email body
        body = f"""
        <html>
            <body>
                <h2>Password Reset Request</h2>
                <p>Hello {user_name},</p>
                <p>You have requested to reset your password for your Socio-Automate Hub account. Please use the following OTP to verify your identity:</p>
                <h1 style="color: #007AFF; font-size: 32px; text-align: center; letter-spacing: 5px;">{otp}</h1>
                <p>This OTP is valid for 10 minutes.</p>
                <p>If you didn't request this reset, please ignore this email or contact our support team.</p>
                <br>
                <p>Best regards,<br>Socio-Automate Hub Team</p>
            </body>
        </html>
        """

        message.attach(MIMEText(body, "html"))

        # Send email
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.send_message(message)

        print(f"OTP email sent to {email}")
        
    except Exception as e:
        print(f"Failed to send email: {str(e)}")
        raise e


# --- API Endpoints ---
@app.route('/login', methods=['POST'])
def login():
    """Authenticate a user and create a session."""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    # Validation
    if not email or not validate_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if not password:
        return jsonify({"error": "Password is required"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT Id, Name, passward, expiry FROM user WHERE email = %s", (email,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if not user:
            return jsonify({"error": "Invalid email or password"}), 401
        if user['passward'] != password:
            return jsonify({"error": "Invalid email or password"}), 401
        if user['expiry'] < datetime.now(TIMEZONE).date():
            return jsonify({"error": "Account expired"}), 403

        # Store user info in session
        session.permanent = True
        session['user_id'] = user['Id']
        session['user_name'] = user['Name']
        session['user_email'] = email

        return jsonify({
            "message": "Login successful",
            "user_id": user['Id'],
            "name": user['Name']
        }), 200
    except mysql.connector.Error as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500


@app.route('/dashboard', methods=['GET'])
def get_dashboard():
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized access"}), 403
    
    user_id = session['user_id']
    email_id = session['user_email']
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        
        # Single query to get all counts for Instagram
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN selected = 'Yes' THEN 1 ELSE 0 END) as active
            FROM instagram 
            WHERE user_id = %s
        """, (email_id,))
        instagram_result = cursor.fetchone()
        
        # Single query to get all counts for Telegram
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN selected = 'Yes' THEN 1 ELSE 0 END) as active
            FROM telegram 
            WHERE user_id = %s
        """, (email_id,))
        telegram_result = cursor.fetchone()
        
        # Single query to get all counts for Facebook
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN selected = 'Yes' THEN 1 ELSE 0 END) as active
            FROM facebook 
            WHERE user_id = %s
        """, (email_id,))
        facebook_result = cursor.fetchone()
        
        # Single query to get all counts for YouTube
        cursor.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN selected = 'Yes' THEN 1 ELSE 0 END) as active
            FROM youtube 
            WHERE user_id = %s
        """, (email_id,))
        youtube_result = cursor.fetchone()
        
        # Calculate posts for today (single query per platform)
        today = datetime.now(TIMEZONE).date()
        tomorrow = today + timedelta(days=1)
        
        posts_today = 0
        for platform in ['instagram', 'telegram', 'facebook', 'youtube']:
            cursor.execute(f"""
                SELECT COUNT(*) as count 
                FROM {platform} 
                WHERE user_id = %s 
                AND next_post_time >= %s 
                AND next_post_time < %s
            """, (email_id, today, tomorrow))
            result = cursor.fetchone()
            posts_today += result['count'] if result else 0
        
        cursor.close()
        conn.close()
        
        instagram_total = instagram_result['total'] if instagram_result else 0
        instagram_active = instagram_result['active'] if instagram_result else 0
        telegram_total = telegram_result['total'] if telegram_result else 0
        telegram_active = telegram_result['active'] if telegram_result else 0
        facebook_total = facebook_result['total'] if facebook_result else 0
        facebook_active = facebook_result['active'] if facebook_result else 0
        youtube_total = youtube_result['total'] if youtube_result else 0
        youtube_active = youtube_result['active'] if youtube_result else 0
        
        total_accounts = instagram_total + telegram_total + facebook_total + youtube_total
        active_schedules = instagram_active + telegram_active + facebook_active + youtube_active
        
        return jsonify({
            "totalAccounts": total_accounts,
            "activeSchedules": active_schedules,
            "postsToday": posts_today,
            "instagramAccounts": instagram_total,
            "telegramAccounts": telegram_total,
            "facebookAccounts": facebook_total,
            "youtubeAccounts": youtube_total
        }), 200
        
    except mysql.connector.Error as e:
        if conn:
            conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/user/<int:user_id>/password', methods=['PATCH'])
def change_password(user_id):
    if 'user_id' not in session or session['user_id'] != user_id:
        return jsonify({"error": "Unauthorized access"}), 403
    data = request.get_json()
    new_password = data.get('new_password')
    if not new_password or len(new_password) < 8:
        return jsonify({"error": "New password must be at least 8 characters long"}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE user SET passward = %s WHERE Id = %s", (new_password, user_id))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "Password updated successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500








@app.route('/logout', methods=['POST'])
def logout():
    """Clear the user session."""
    session.clear()
    return jsonify({"message": "Logged out successfully"}), 200

@app.route('/signup', methods=['POST'])
def signup():
    """Create a new user in the user table."""
    data = request.get_json()
    name = data.get('name')
    password = data.get('password')
    email = data.get('email')
    expiry = data.get('expiry', (datetime.now(TIMEZONE) + timedelta(days=365)).strftime('%Y-%m-%d'))
    phone_number = data.get('phone_number')

    # Validation
    if not name or len(name) < 3:
        return jsonify({"error": "Name must be at least 3 characters long"}), 400
    if not password or len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long"}), 400
    if not validate_email(email):
        return jsonify({"error": "Invalid email format"}), 400
    try:
        datetime.strptime(expiry, '%Y-%m-%d')
    except ValueError:
        return jsonify({"error": "Invalid expiry date format (use YYYY-MM-DD)"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Check for duplicate email
        cursor.execute("SELECT Id FROM user WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "Email already exists"}), 400

        # Insert user
        query = "INSERT INTO user (Name, passward, email, expiry, phone_number) VALUES (%s, %s, %s, %s, %s)"
        cursor.execute(query, (name, password, email, expiry, phone_number))
        user_id = cursor.lastrowid
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "User created successfully", "user_id": user_id}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/user/<int:user_id>', methods=['PATCH'])
def update_user(user_id):
    """Update user details in the user table."""
    data = request.get_json()
    name = data.get('name')
    password = data.get('password')
    email = data.get('email')
    expiry = data.get('expiry')

    # Validation
    if name and len(name) < 3:
        return jsonify({"error": "Name must be at least 3 characters long"}), 400
    if password and len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long"}), 400
    if email and not validate_email(email):
        return jsonify({"error": "Invalid email format"}), 400
    if expiry:
        try:
            datetime.strptime(expiry, '%Y-%m-%d')
        except ValueError:
            return jsonify({"error": "Invalid expiry date format (use YYYY-MM-DD)"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify user exists
        cursor.execute("SELECT Id FROM user WHERE Id = %s", (user_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "User ID does not exist"}), 400

        # Check for duplicate email
        if email:
            cursor.execute("SELECT Id FROM user WHERE email = %s AND Id != %s", (email, user_id))
            if cursor.fetchone():
                cursor.close()
                conn.close()
                return jsonify({"error": "Email already exists"}), 400

        # Build dynamic update query
        updates = []
        params = []
        if name:
            updates.append("Name = %s")
            params.append(name)
        if password:
            updates.append("passward = %s")
            params.append(password)
        if email:
            updates.append("email = %s")
            params.append(email)
        if expiry:
            updates.append("expiry = %s")
            params.append(expiry)

        if not updates:
            cursor.close()
            conn.close()
            return jsonify({"error": "No fields provided to update"}), 400

        query = f"UPDATE user SET {', '.join(updates)} WHERE Id = %s"
        params.append(user_id)
        cursor.execute(query, params)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "User updated successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/user/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    """Delete a user and their associated platform records."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify user exists
        cursor.execute("SELECT Id FROM user WHERE Id = %s", (user_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "User ID does not exist"}), 400

        # Delete user (cascading deletes will remove platform records)
        cursor.execute("DELETE FROM user WHERE Id = %s", (user_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "User and associated records deleted successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/instagram/<int:record_id>', methods=['PATCH'])
def update_instagram(record_id):
    """Update an existing Instagram account."""
    data = request.get_json()
    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    sch_start_range = data.get('sch_start_range')
    sch_end_range = data.get('sch_end_range')
    number_of_posts = data.get('number_of_posts')

    # Validation
    if email and not validate_email(email):
        return jsonify({"error": "Invalid email format"}), 400
    if username and len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
    if password and len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long"}), 400
    if sch_start_range and not time_to_timedelta(sch_start_range):
        return jsonify({"error": "Invalid sch_start_range format (use HH:MM:SS)"}), 400
    if sch_end_range and not time_to_timedelta(sch_end_range):
        return jsonify({"error": "Invalid sch_end_range format (use HH:MM:SS)"}), 400
    if number_of_posts is not None and number_of_posts < 0:
        return jsonify({"error": "Number of posts must be non-negative"}), 400

    # Fetch user_id if email provided
    user_id = None
    if email:
        user_id = get_user_id_from_email(email)
        if not user_id:
            return jsonify({"error": "User not available for the provided email"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify record exists
        cursor.execute("SELECT user_id FROM instagram WHERE id = %s", (record_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            conn.close()
            return jsonify({"error": "Instagram record not found"}), 400
        current_user_id = result[0]

        # If email provided, ensure it matches the record's user_id
        if user_id and user_id != current_user_id:
            cursor.close()
            conn.close()
            return jsonify({"error": "Email does not match the user associated with this Instagram record"}), 400

        # Build dynamic update query
        updates = []
        params = []
        if username:
            updates.append("username = %s")
            params.append(username)
        if password:
            updates.append("passwand = %s")
            params.append(password)
        if email:
            updates.append("email = %s")
            params.append(email)
        if sch_start_range:
            updates.append("sch_start_range = %s")
            params.append(sch_start_range)
        if sch_end_range:
            updates.append("sch_end_range = %s")
            params.append(sch_end_range)
        if number_of_posts is not None:
            updates.append("number_of_posts = %s")
            updates.append("posts_left = %s")
            params.extend([number_of_posts, number_of_posts])

        if not updates:
            cursor.close()
            conn.close()
            return jsonify({"error": "No fields provided to update"}), 400

        # Always reset scheduling fields
        updates.extend(["selected = 'No'", "done = 'No'", "next_post_time = NULL"])
        query = f"UPDATE instagram SET {', '.join(updates)} WHERE id = %s"
        params.append(record_id)

        cursor.execute(query, params)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "Instagram account updated successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/telegram/<int:record_id>', methods=['PATCH'])
def update_telegram(record_id):
    """Update an existing Telegram channel."""
    data = request.get_json()
    email = data.get('email')
    channel_name = data.get('channel_name')
    token_sesson = data.get('token_sesson')
    sch_start_range = data.get('sch_start_range')
    sch_end_range = data.get('sch_end_range')
    number_of_posts = data.get('number_of_posts')

    # Validation
    if email and not validate_email(email):
        return jsonify({"error": "Invalid email format"}), 400
    if channel_name and len(channel_name) < 3:
        return jsonify({"error": "Channel name must be at least 3 characters long"}), 400
    if token_sesson and (not token_sesson.startswith('@') and not token_sesson.startswith('-')):
        return jsonify({"error": "Invalid token_sesson (must start with '@' or '-')"}), 400
    if sch_start_range and not time_to_timedelta(sch_start_range):
        return jsonify({"error": "Invalid sch_start_range format (use HH:MM:SS)"}), 400
    if sch_end_range and not time_to_timedelta(sch_end_range):
        return jsonify({"error": "Invalid sch_end_range format (use HH:MM:SS)"}), 400
    if number_of_posts is not None and number_of_posts < 0:
        return jsonify({"error": "Number of posts must be non-negative"}), 400

    # Fetch user_id if email provided
    user_id = None
    if email:
        user_id = get_user_id_from_email(email)
        if not user_id:
            return jsonify({"error": "User not available for the provided email"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify record exists
        cursor.execute("SELECT user_id FROM telegram WHERE id = %s", (record_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            conn.close()
            return jsonify({"error": "Telegram record not found"}), 400
        current_user_id = result[0]

        # If email provided, ensure it matches the record's user_id
        if user_id and user_id != current_user_id:
            cursor.close()
            conn.close()
            return jsonify({"error": "Email does not match the user associated with this Telegram record"}), 400

        # Build dynamic update query
        updates = []
        params = []
        if channel_name:
            updates.append("channel_name = %s")
            params.append(channel_name)
        if token_sesson:
            updates.append("token_sesson = %s")
            params.append(token_sesson)
        if email:
            updates.append("email = %s")
            params.append(email)
        if sch_start_range:
            updates.append("sch_start_range = %s")
            params.append(sch_start_range)
        if sch_end_range:
            updates.append("sch_end_range = %s")
            params.append(sch_end_range)
        if number_of_posts is not None:
            updates.append("number_of_posts = %s")
            updates.append("posts_left = %s")
            params.extend([number_of_posts, number_of_posts])

        if not updates:
            cursor.close()
            conn.close()
            return jsonify({"error": "No fields provided to update"}), 400

        # Always reset scheduling fields
        updates.extend(["selected = 'No'", "done = 'No'", "next_post_time = NULL"])
        query = f"UPDATE telegram SET {', '.join(updates)} WHERE id = %s"
        params.append(record_id)

        cursor.execute(query, params)
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "Telegram channel updated successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500
@app.route('/delete-media', methods=['DELETE'])
def delete_media():
    """Delete media from Google Drive and schedule."""
    data = request.get_json()
    platform = data.get('platform')
    account_id = data.get('account_id')
    file_id = data.get('file_id')

    if not all([platform, account_id, file_id]):
        return jsonify({"error": "Missing required parameters"}), 400

    if platform not in ['instagram', 'telegram', 'facebook', 'youtube']:
        return jsonify({"error": "Invalid platform"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        
        # Get account details for Drive credentials
        if platform == 'youtube':
            cursor.execute(f"SELECT token_sesson FROM {platform} WHERE id = %s", (account_id,))
        else:
            cursor.execute(f"SELECT token_drive FROM {platform} WHERE id = %s", (account_id,))
            
        account = cursor.fetchone()
        
        if not account:
            cursor.close()
            conn.close()
            return jsonify({"error": "Account not found"}), 404

        # Delete from Google Drive
        token_data = account.get('token_sesson' if platform == 'youtube' else 'token_drive', '{}')
        if token_data and token_data != "{}":
            try:
                token_drive = json.loads(token_data)
                creds = Credentials.from_authorized_user_info(token_drive, SCOPES)
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                
                service = build('drive', 'v3', credentials=creds)
                service.files().delete(fileId=file_id).execute()
                print(f"✅ Deleted file from Google Drive: {file_id}")
            except Exception as e:
                print(f"⚠️ Could not delete from Google Drive: {str(e)}")
                # Continue with database deletion even if Drive delete fails

        # Remove from custom_schedule_data
        cursor.execute(f"SELECT custom_schedule_data FROM {platform} WHERE id = %s", (account_id,))
        result = cursor.fetchone()
        
        if result and result['custom_schedule_data']:
            try:
                schedule_data = json.loads(result['custom_schedule_data'])
                if isinstance(schedule_data, list):
                    # Filter out the deleted media
                    updated_schedule = [item for item in schedule_data if item.get('file_id') != file_id]
                    updated_schedule_json = json.dumps(updated_schedule)
                    
                    # Update database
                    cursor.execute(f"UPDATE {platform} SET custom_schedule_data = %s WHERE id = %s", 
                                 (updated_schedule_json, account_id))
                    conn.commit()
            except json.JSONDecodeError:
                pass

        cursor.close()
        conn.close()
        
        return jsonify({"message": "Media deleted successfully"}), 200

    except Exception as e:
        conn.close()
        return jsonify({"error": f"Failed to delete media: {str(e)}"}), 500


@app.route('/update-media-schedule', methods=['PATCH'])
def update_media_schedule():
    """Update individual media schedule."""
    data = request.get_json()
    platform = data.get('platform')
    account_id = data.get('account_id')
    media_data = data.get('media_data')

    if not all([platform, account_id, media_data]):
        return jsonify({"error": "Missing required parameters"}), 400

    if platform not in ['instagram', 'telegram', 'facebook', 'youtube']:
        return jsonify({"error": "Invalid platform"}), 400

    # FIXED: Validate media_data format properly
    try:
        if not isinstance(media_data, dict):
            return jsonify({"error": "media_data must be an object"}), 400
        
        # Validate required fields
        required_fields = ['media_name', 'file_id']
        for field in required_fields:
            if field not in media_data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        # Only validate datetime if provided and not None
        scheduled_datetime = media_data.get('scheduled_datetime')
        if scheduled_datetime is not None:
            try:
                datetime.strptime(scheduled_datetime, '%Y-%m-%d %H:%M:%S')
            except ValueError:
                return jsonify({"error": "Invalid datetime format. Use YYYY-MM-DD HH:MM:SS"}), 400
                
    except Exception as e:
        return jsonify({"error": f"Invalid media_data format: {str(e)}"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        
        # Get current schedule data
        cursor.execute(f"SELECT custom_schedule_data FROM {platform} WHERE id = %s", (account_id,))
        result = cursor.fetchone()
        
        current_schedule_data = []
        if result and result['custom_schedule_data']:
            try:
                current_schedule_data = json.loads(result['custom_schedule_data'])
                if not isinstance(current_schedule_data, list):
                    current_schedule_data = []
            except json.JSONDecodeError:
                current_schedule_data = []

        # Update the specific media item
        updated_schedule = []
        for item in current_schedule_data:
            if (item.get('media_name') == media_data.get('media_name') and 
                item.get('file_id') == media_data.get('file_id')):
                updated_schedule.append(media_data)
            else:
                updated_schedule.append(item)

        # Update database
        updated_schedule_json = json.dumps(updated_schedule)
        cursor.execute(f"UPDATE {platform} SET custom_schedule_data = %s WHERE id = %s", 
                     (updated_schedule_json, account_id))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({"message": "Media schedule updated successfully"}), 200

    except Exception as e:
        conn.close()
        return jsonify({"error": f"Failed to update media schedule: {str(e)}"}), 500











@app.route('/upload-media-chunk', methods=['POST'])
def upload_media_chunk():
    """Handle chunked file uploads with caption support."""
    try:
        chunk_file = request.files.get('chunk')
        account_id = request.form.get('account_id')
        platform = request.form.get('platform')
        user_id = request.form.get('user_id')
        chunk_index = int(request.form.get('chunk_index', 0))
        total_chunks = int(request.form.get('total_chunks', 1))
        upload_id = request.form.get('upload_id')
        original_name = request.form.get('original_name')
        
        # Extract caption from first chunk only to avoid duplication
        caption = request.form.get('caption', '') if chunk_index == 0 else ''

        if not all([chunk_file, account_id, platform, user_id, upload_id, original_name]):
            return jsonify({"error": "Missing required parameters"}), 400

        # Create upload directory if it doesn't exist
        upload_dir = f"temp_uploads/{upload_id}"
        os.makedirs(upload_dir, exist_ok=True)

        # Save chunk
        chunk_filename = f"{upload_dir}/chunk_{chunk_index:04d}"
        chunk_file.save(chunk_filename)

        # Track chunk progress
        if upload_id not in upload_chunks:
            upload_chunks[upload_id] = []
        upload_chunks[upload_id].append(chunk_index)

        # Update status with caption (store only from first chunk)
        if upload_id not in upload_status:
            upload_status[upload_id] = {
                'uploaded_chunks': len(upload_chunks[upload_id]),
                'total_chunks': total_chunks,
                'account_id': account_id,
                'platform': platform,
                'user_id': user_id,
                'original_name': original_name,
                'caption': caption if chunk_index == 0 else ''
            }
        else:
            upload_status[upload_id]['uploaded_chunks'] = len(upload_chunks[upload_id])
            # Only update caption if it's the first chunk and we don't have one yet
            if chunk_index == 0 and caption and not upload_status[upload_id].get('caption'):
                upload_status[upload_id]['caption'] = caption

        return jsonify({
            "message": f"Chunk {chunk_index + 1}/{total_chunks} uploaded successfully",
            "chunk_index": chunk_index,
            "uploaded_chunks": len(upload_chunks[upload_id]),
            "total_chunks": total_chunks,
            "success": True
        }), 200

    except Exception as e:
        return jsonify({"error": f"Chunk upload failed: {str(e)}", "success": False}), 500
# Find the existing finalize-upload endpoint and UPDATE it:



@app.route('/finalize-upload', methods=['POST'])
def finalize_upload():
    """Combine chunks and upload to Google Drive with scheduling and caption support."""
    try:
        upload_id = request.form.get('upload_id')
        account_id = request.form.get('account_id')
        platform = request.form.get('platform')
        user_id = request.form.get('user_id')
        original_name = request.form.get('original_name')
        total_chunks = int(request.form.get('total_chunks', 1))
        
        # Get scheduling data from form
        schedule_type = request.form.get('schedule_type', 'range')
        scheduled_datetime = request.form.get('scheduled_datetime')
        
        # Get caption from form data or from stored upload status
        caption = request.form.get('caption', '')
        if not caption and upload_id in upload_status:
            caption = upload_status[upload_id].get('caption', '')

        if not all([upload_id, account_id, platform, user_id, original_name]):
            return jsonify({"error": "Missing required parameters"}), 400

        # Verify all chunks are uploaded
        uploaded_chunks = upload_chunks.get(upload_id, [])
        if len(uploaded_chunks) != total_chunks:
            return jsonify({
                "error": f"Incomplete upload: {len(uploaded_chunks)}/{total_chunks} chunks received"
            }), 400

        # Combine chunks in a background thread with scheduling data and caption
        thread = threading.Thread(
            target=combine_and_upload_chunks,
            args=(upload_id, account_id, platform, user_id, original_name, total_chunks, schedule_type, scheduled_datetime, caption)
        )
        thread.daemon = True
        thread.start()

        return jsonify({
            "message": "Upload finalization started",
            "upload_id": upload_id,
            "status": "processing",
            "caption": caption,  # Return caption in response
            "success": True
        }), 200

    except Exception as e:
        return jsonify({"error": f"Finalization failed: {str(e)}", "success": False}), 500





# Add this after your existing endpoints, before the if __name__ block

# Add this new endpoint for updating custom schedule data
@app.route('/<platform>/<int:record_id>/custom-schedule', methods=['PATCH'])
def update_custom_schedule(platform, record_id):
    """Update custom schedule data for a platform account."""
    if platform not in ['instagram', 'telegram', 'facebook', 'youtube']:
        return jsonify({"error": "Invalid platform"}), 400

    data = request.get_json()
    custom_schedule_data = data.get('custom_schedule_data')

    # Validate custom_schedule_data format - FIXED: Handle None values properly
    if custom_schedule_data is not None:
        try:
            # Validate it's a list
            if not isinstance(custom_schedule_data, list):
                return jsonify({"error": "custom_schedule_data must be a list"}), 400
            
            # Validate each item in the list
            for item in custom_schedule_data:
                if not isinstance(item, dict):
                    return jsonify({"error": "Each schedule item must be an object"}), 400
                
                required_fields = ['media_name', 'file_id']
                for field in required_fields:
                    if field not in item:
                        return jsonify({"error": f"Missing required field: {field}"}), 400
                
                # FIXED: Only validate datetime if it's provided and not None
                scheduled_datetime = item.get('scheduled_datetime')
                if scheduled_datetime is not None:
                    try:
                        datetime.strptime(scheduled_datetime, '%Y-%m-%d %H:%M:%S')
                    except ValueError:
                        return jsonify({"error": "Invalid datetime format. Use YYYY-MM-DD HH:MM:SS"}), 400

            # Convert to JSON string for storage
            custom_schedule_json = json.dumps(custom_schedule_data)
        except Exception as e:
            return jsonify({"error": f"Invalid custom_schedule_data format: {str(e)}"}), 400
    else:
        custom_schedule_json = None

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        
        # Verify record exists
        cursor.execute(f"SELECT id FROM {platform} WHERE id = %s", (record_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": f"{platform.capitalize()} record not found"}), 404

        # Update custom_schedule_data
        query = f"UPDATE {platform} SET custom_schedule_data = %s WHERE id = %s"
        cursor.execute(query, (custom_schedule_json, record_id))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({"message": "Custom schedule data updated successfully"}), 200

    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

# Add this new endpoint for getting custom schedule data
@app.route('/<platform>/<int:record_id>/custom-schedule', methods=['GET'])
def get_custom_schedule(platform, record_id):
    """Get custom schedule data for a platform account."""
    if platform not in ['instagram', 'telegram', 'facebook', 'youtube']:
        return jsonify({"error": "Invalid platform"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        
        # Get custom_schedule_data
        cursor.execute(f"SELECT custom_schedule_data FROM {platform} WHERE id = %s", (record_id,))
        result = cursor.fetchone()
        
        if not result:
            cursor.close()
            conn.close()
            return jsonify({"error": f"{platform.capitalize()} record not found"}), 404

        custom_schedule_data = None
        if result['custom_schedule_data']:
            try:
                custom_schedule_data = json.loads(result['custom_schedule_data'])
            except json.JSONDecodeError:
                custom_schedule_data = None

        cursor.close()
        conn.close()

        return jsonify({
            "custom_schedule_data": custom_schedule_data
        }), 200

    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500


# Add this function after the helper functions section, before the API endpoints
def process_upload_with_scheduling(platform, account_id, media_data):
    """Process upload and update custom schedule data for both range and datetime scheduling with caption support."""
    try:
        schedule_type = media_data.get('schedule_type', 'range')
        scheduled_datetime = media_data.get('scheduled_datetime')
        caption = media_data.get('caption', '')  # EXTRACT CAPTION FROM MEDIA_DATA
        
        # Always process scheduling data, regardless of schedule type
        conn = get_db_connection()
        if not conn:
            return
            
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(f"SELECT custom_schedule_data FROM {platform} WHERE id = %s", (account_id,))
            result = cursor.fetchone()
            
            current_schedule_data = []
            if result and result['custom_schedule_data']:
                try:
                    current_schedule_data = json.loads(result['custom_schedule_data'])
                    if not isinstance(current_schedule_data, list):
                        current_schedule_data = []
                except json.JSONDecodeError:
                    current_schedule_data = []
            
            # Check if this file was already added (prevent duplicates from retries)
            existing_entry = None
            for item in current_schedule_data:
                if (item.get('media_name') == media_data.get('original_name') and 
                    item.get('scheduled_datetime') == scheduled_datetime and
                    item.get('schedule_type') == schedule_type):
                    existing_entry = item
                    break
            
            if existing_entry:
                # Update existing entry with new file_id and caption if needed
                existing_entry['file_id'] = media_data.get('file_id', existing_entry.get('file_id', ''))
                existing_entry['upload_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                existing_entry['caption'] = caption  # UPDATE CAPTION IN EXISTING ENTRY
                print(f"✅ Updated existing schedule entry for {media_data.get('original_name')} with caption: {caption}")
            else:
                # Add new schedule item WITH CAPTION
                new_schedule_item = {
                    'media_name': media_data.get('original_name', 'unknown'),
                    'scheduled_datetime': scheduled_datetime if schedule_type == 'datetime' else None,
                    'file_id': media_data.get('file_id', ''),
                    'status': 'pending',
                    'upload_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'schedule_type': schedule_type,
                    'caption': caption  # ADD CAPTION FIELD HERE
                }
                
                current_schedule_data.append(new_schedule_item)
                print(f"✅ Added {schedule_type} schedule for {media_data.get('original_name')} with caption: {caption}")
            
            # Update database
            updated_schedule_json = json.dumps(current_schedule_data)
            cursor.execute(f"UPDATE {platform} SET custom_schedule_data = %s WHERE id = %s", 
                         (updated_schedule_json, account_id))
            conn.commit()
            cursor.close()
            
        except Exception as e:
            print(f"Error updating custom schedule: {str(e)}")
        finally:
            conn.close()
                
    except Exception as e:
        print(f"Error in process_upload_with_scheduling: {str(e)}")















# Find the combine_and_upload_chunks function and UPDATE it:
def combine_and_upload_chunks(upload_id, account_id, platform, user_id, original_name, total_chunks, schedule_type='range', scheduled_datetime=None, caption=''):
    """Combine chunks and upload to Google Drive in background with scheduling and caption support."""
    try:
        upload_dir = f"temp_uploads/{upload_id}"
        combined_path = f"temp_uploads/{upload_id}_combined_{original_name}"

        # Combine chunks
        with open(combined_path, 'wb') as output_file:
            for chunk_index in range(total_chunks):
                chunk_path = f"{upload_dir}/chunk_{chunk_index:04d}"
                with open(chunk_path, 'rb') as chunk_file:
                    output_file.write(chunk_file.read())

        # Upload to Google Drive using existing logic
        conn = get_db_connection()
        if not conn:
            upload_status[upload_id]['status'] = 'failed'
            upload_status[upload_id]['error'] = 'Database connection failed'
            return

        try:
            cursor = conn.cursor(dictionary=True)
            
            # Build query based on platform
            if platform == 'youtube':
                cursor.execute(f"SELECT google_drive_link, token_sesson FROM {platform} WHERE id = %s AND user_id = %s", (account_id, user_id))
            else:
                cursor.execute(f"SELECT google_drive_link, token_drive FROM {platform} WHERE id = %s AND user_id = %s", (account_id, user_id))
                
            account = cursor.fetchone()
            cursor.close()

            if not account:
                upload_status[upload_id]['status'] = 'failed'
                upload_status[upload_id]['error'] = 'Account not found'
                return

            # Extract folder ID and upload
            folder_id_match = re.search(r'folders/([a-zA-Z0-9-_]+)', account.get('google_drive_link', ''))
            if folder_id_match:
                folder_id = folder_id_match.group(1)
                
                # Handle token
                if platform == 'youtube':
                    token_data = account.get('token_sesson', '{}')
                else:
                    token_data = account.get('token_drive', '{}')
                
                if token_data and token_data != "{}":
                    token_drive = json.loads(token_data)
                    creds = Credentials.from_authorized_user_info(token_drive, SCOPES)
                    if creds and creds.expired and creds.refresh_token:
                        creds.refresh(Request())
                    
                    service = build('drive', 'v3', credentials=creds)
                    
                    file_metadata = {
                        'name': original_name,
                        'parents': [folder_id]
                    }
                    
                    # Determine MIME type
                    mime_type = 'image/jpeg'
                    if original_name.lower().endswith(('.mp4', '.mov', '.avi')):
                        mime_type = 'video/mp4'
                    elif original_name.lower().endswith('.png'):
                        mime_type = 'image/png'
                    elif original_name.lower().endswith('.gif'):
                        mime_type = 'image/gif'

                    media = MediaFileUpload(combined_path, mimetype=mime_type)
                    
                    uploaded_file = service.files().create(
                        body=file_metadata, 
                        media_body=media, 
                        fields='id,name,webViewLink,createdTime'
                    ).execute()

                    # Clean up duplicate files
                    cleanup_duplicate_files(service, folder_id, original_name, uploaded_file['id'])

                    media.stream().close() if hasattr(media, 'stream') else None

                    # PROCESS SCHEDULING DATA WITH CAPTION AFTER SUCCESSFUL UPLOAD
                    schedule_data = {
                        'schedule_type': schedule_type,
                        'scheduled_datetime': scheduled_datetime,
                        'original_name': original_name,
                        'file_id': uploaded_file['id'],
                        'caption': caption  # INCLUDE CAPTION
                    }
                    process_upload_with_scheduling(platform, account_id, schedule_data)

                    upload_status[upload_id]['status'] = 'completed'
                    upload_status[upload_id]['file_id'] = uploaded_file['id']
                    upload_status[upload_id]['drive_link'] = uploaded_file.get('webViewLink', '')
                    upload_status[upload_id]['caption'] = caption  # STORE CAPTION IN STATUS
                else:
                    upload_status[upload_id]['status'] = 'completed'
                    upload_status[upload_id]['message'] = 'File processed (no Drive token)'
                    upload_status[upload_id]['caption'] = caption  # STORE CAPTION IN STATUS
            else:
                upload_status[upload_id]['status'] = 'completed'
                upload_status[upload_id]['message'] = 'File processed (no Drive configured)'
                upload_status[upload_id]['caption'] = caption  # STORE CAPTION IN STATUS

        except Exception as e:
            upload_status[upload_id]['status'] = 'failed'
            upload_status[upload_id]['error'] = str(e)
        finally:
            conn.close()

        # Cleanup
        try:
            import shutil
            shutil.rmtree(upload_dir, ignore_errors=True)
            if os.path.exists(combined_path):
                os.remove(combined_path)
        except:
            pass

    except Exception as e:
        upload_status[upload_id]['status'] = 'failed'
        upload_status[upload_id]['error'] = str(e)

@app.route('/upload-status/<upload_id>', methods=['GET'])
def get_upload_status(upload_id):
    """Check status of chunked upload."""
    status = upload_status.get(upload_id, {})
    return jsonify(status), 200








# Find the existing upload-media endpoint and UPDATE it:
@app.route('/upload-media', methods=['POST'])
def upload_media():
    """Handle both single file and chunked uploads with scheduling and caption support."""
    if 'file' not in request.files and 'chunk' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    # If it's a chunk, redirect to chunk upload handler
    if 'chunk' in request.files:
        return upload_media_chunk()

    file = request.files['file']
    account_id = request.form.get('account_id')
    platform = request.form.get('platform')
    user_id = request.form.get('user_id')
    
    # Extract caption from form data
    caption = request.form.get('caption', '')

    if not account_id or not platform or not user_id:
        return jsonify({"error": "Missing required parameters: account_id, platform, user_id"}), 400

    if platform not in ['instagram', 'telegram', 'youtube']:
        return jsonify({"error": "Invalid platform"}), 400

    table = 'instagram' if platform == 'instagram' else 'telegram' if platform == 'telegram' else 'youtube'

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    temp_path = None
    try:
        cursor = conn.cursor(dictionary=True)
        
        # Query tokens based on platform
        if platform == 'youtube':
            cursor.execute(f"SELECT google_drive_link, token_sesson FROM {table} WHERE id = %s AND user_id = %s", (account_id, user_id))
        else:
            cursor.execute(f"SELECT google_drive_link, token_drive FROM {table} WHERE id = %s AND user_id = %s", (account_id, user_id))
            
        account = cursor.fetchone()
        cursor.close()

        if not account:
            conn.close()
            return jsonify({"error": "Account not found or does not belong to user"}), 404

        # Check Google Drive link
        if not account.get('google_drive_link'):
            conn.close()
            return jsonify({"message": "File queued for upload (no Drive configured)", "file_id": "no_drive"}), 200

        folder_id_match = re.search(r'folders/([a-zA-Z0-9-_]+)', account['google_drive_link'])
        if not folder_id_match:
            conn.close()
            return jsonify({"error": "Invalid Google Drive link format"}), 400
        folder_id = folder_id_match.group(1)

        # Handle Drive token
        token_data = account.get('token_sesson' if platform == 'youtube' else 'token_drive', '{}')
        if not token_data or token_data == "{}":
            conn.close()
            return jsonify({"message": "File queued for upload (no Drive token)", "file_id": "no_token"}), 200

        try:
            token_drive = json.loads(token_data)
            creds = Credentials.from_authorized_user_info(token_drive, SCOPES)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
        except Exception as e:
            conn.close()
            return jsonify({"error": f"Failed to load Google Drive credentials: {str(e)}"}), 500

        # Build Google Drive service
        service = build('drive', 'v3', credentials=creds)

        # Check if file already exists in the folder to prevent duplicates
        try:
            query = f"name = '{file.filename}' and '{folder_id}' in parents and trashed = false"
            existing_files = service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)',
                pageSize=1
            ).execute()
            
            if existing_files.get('files'):
                # File already exists, return success without uploading
                existing_file = existing_files['files'][0]
                print(f"📁 File already exists in Drive: {file.filename}, using existing file ID: {existing_file['id']}")
                
                # Still process scheduling data
                schedule_data = {
                    'schedule_type': request.form.get('schedule_type', 'range'),
                    'scheduled_datetime': request.form.get('scheduled_datetime'),
                    'original_name': file.filename,
                    'file_id': existing_file['id'],
                    'caption': caption
                }
                process_upload_with_scheduling(platform, account_id, schedule_data)
                
                conn.close()
                return jsonify({
                    "message": "File already exists in Drive, scheduling updated",
                    "file_id": existing_file['id'],
                    "file_name": file.filename,
                    "drive_link": f"https://drive.google.com/file/d/{existing_file['id']}/view",
                    "caption": caption,
                    "success": True,
                    "duplicate": True  # Add flag to identify duplicates
                }), 200
        except Exception as e:
            print(f"⚠️ Could not check for existing files: {str(e)}")
            # Continue with upload if check fails

        # Save temp file
        temp_dir = 'temp_uploads'
        os.makedirs(temp_dir, exist_ok=True)
        file_extension = os.path.splitext(file.filename)[1] if file.filename else '.jpg'
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        temp_path = os.path.join(temp_dir, unique_filename)
        file.save(temp_path)

        # Detect MIME type
        mime_type = 'image/jpeg'
        if file.filename:
            lower = file.filename.lower()
            if lower.endswith(('.mp4', '.mov', '.avi')):
                mime_type = 'video/mp4'
            elif lower.endswith('.png'):
                mime_type = 'image/png'
            elif lower.endswith('.gif'):
                mime_type = 'image/gif'

        # Upload to Google Drive
        file_metadata = {'name': file.filename or unique_filename, 'parents': [folder_id]}
        media = MediaFileUpload(temp_path, mimetype=mime_type)
        uploaded_file = service.files().create(
            body=file_metadata, media_body=media, fields='id,name,webViewLink,createdTime'
        ).execute()

        # Clean up duplicate files (keep only the most recent)
        cleanup_duplicate_files(service, folder_id, file.filename or unique_filename, uploaded_file['id'])

        # Close and clean temp file
        media.stream().close() if hasattr(media, 'stream') else None
        max_retries = 3
        for attempt in range(max_retries):
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                break
            except PermissionError:
                if attempt < max_retries - 1:
                    time.sleep(0.1)
                else:
                    print(f"Warning: Could not delete temp file {temp_path}")

        # PROCESS SCHEDULING DATA WITH CAPTION AFTER SUCCESSFUL UPLOAD
        schedule_data = {
            'schedule_type': request.form.get('schedule_type', 'range'),
            'scheduled_datetime': request.form.get('scheduled_datetime'),
            'original_name': file.filename or unique_filename,
            'file_id': uploaded_file['id'],
            'caption': caption
        }
        process_upload_with_scheduling(platform, account_id, schedule_data)

        conn.close()
        
        # Return consistent success response
        return jsonify({
            "message": "Upload successful",
            "file_id": uploaded_file['id'],
            "file_name": uploaded_file['name'],
            "drive_link": uploaded_file.get('webViewLink', ''),
            "caption": caption,
            "success": True
        }), 200

    except HttpError as e:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass
        conn.close()
        return jsonify({"error": f"Google Drive error: {str(e)}", "success": False}), 500

    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass
        conn.close()
        return jsonify({"error": f"Upload failed: {str(e)}", "success": False}), 500



def cleanup_duplicate_files(service, folder_id, file_name, current_file_id):
    """Check for and delete duplicate files with the same name in the same folder."""
    try:
        # Search for files with the same name in the same folder
        query = f"name = '{file_name}' and '{folder_id}' in parents and trashed = false"
        results = service.files().list(
            q=query,
            spaces='drive',
            fields='files(id, name, createdTime)'
        ).execute()
        
        files = results.get('files', [])
        
        # If multiple files with same name exist, keep only the most recent one
        if len(files) > 1:
            print(f"🔍 Found {len(files)} files with name '{file_name}' in folder {folder_id}")
            
            # Sort files by creation time (newest first)
            files.sort(key=lambda x: x.get('createdTime', ''), reverse=True)
            
            # Keep the most recent file (which should be our current upload)
            files_to_delete = files[1:]  # All except the first (most recent)
            
            for file_to_delete in files_to_delete:
                if file_to_delete['id'] != current_file_id:
                    try:
                        service.files().delete(fileId=file_to_delete['id']).execute()
                        print(f"🗑️ Deleted duplicate file: {file_to_delete['id']} ({file_name})")
                    except Exception as e:
                        print(f"⚠️ Failed to delete duplicate file {file_to_delete['id']}: {str(e)}")
            
            print(f"✅ Cleaned up {len(files_to_delete)} duplicate files")
            
    except Exception as e:
        print(f"❌ Error during duplicate cleanup: {str(e)}")

@app.route('/instagram/<int:record_id>', methods=['DELETE'])
def delete_instagram(record_id):
    """Delete an Instagram account."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify record exists
        cursor.execute("SELECT id FROM instagram WHERE id = %s", (record_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "Instagram record not found"}), 400

        cursor.execute("DELETE FROM instagram WHERE id = %s", (record_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "Instagram account deleted successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/telegram/<int:record_id>', methods=['DELETE'])
def delete_telegram(record_id):
    """Delete a Telegram channel."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify record exists
        cursor.execute("SELECT id FROM telegram WHERE id = %s", (record_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "Telegram record not found"}), 400

        cursor.execute("DELETE FROM telegram WHERE id = %s", (record_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "Telegram channel deleted successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/schedule/reset', methods=['POST'])
def reset_schedule():
    """Reset scheduling for specified platforms."""
    data = request.get_json()
    platform = data.get('platform', 'both').lower()

    if platform not in ['instagram', 'telegram', 'facebook', 'youtube', 'both']:
        return jsonify({"error": "Invalid platform (use 'instagram', 'telegram', 'facebook', 'youtube', or 'both')"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        instagram_count = 0
        telegram_count = 0
        facebook_count = 0
        youtube_count = 0

        if platform in ['instagram', 'both']:
            cursor.execute("""
                UPDATE instagram SET 
                    selected = 'No', 
                    done = 'No', 
                    next_post_time = NULL 
                WHERE posts_left > 0
            """)
            instagram_count = cursor.rowcount

        if platform in ['telegram', 'both']:
            cursor.execute("""
                UPDATE telegram SET 
                    selected = 'No', 
                    done = 'No', 
                    next_post_time = NULL 
                WHERE posts_left > 0
            """)
            telegram_count = cursor.rowcount

        if platform in ['facebook', 'both']:
            cursor.execute("""
                UPDATE facebook SET 
                    selected = 'No', 
                    done = 'No', 
                    next_post_time = NULL 
                WHERE posts_left > 0
            """)
            facebook_count = cursor.rowcount

        if platform in ['youtube', 'both']:
            cursor.execute("""
                UPDATE youtube SET 
                    selected = 'No', 
                    done = 'No', 
                    next_post_time = NULL 
                WHERE posts_left > 0
            """)
            youtube_count = cursor.rowcount

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({
            "message": f"Reset {instagram_count} Instagram, {telegram_count} Telegram, {facebook_count} Facebook, and {youtube_count} YouTube records"
        }), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/schedule/status', methods=['GET'])
def schedule_status():
    """Retrieve scheduling status for specified platforms."""
    platform = request.args.get('platform', 'both').lower()
    email = request.args.get('email')

    if platform not in ['instagram', 'telegram', 'facebook', 'youtube', 'both']:
        return jsonify({"error": "Invalid platform (use 'instagram', 'telegram', 'facebook', 'youtube', or 'both')"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        result = {}

        # Fetch user_id if email provided
        user_id = None
        if email:
            user_id = get_user_id_from_email(email)
            if not user_id:
                cursor.close()
                conn.close()
                return jsonify({"error": "User not available for the provided email"}), 400

        # Helper function to serialize records
        def serialize_records(records):
            serialized = []
            for record in records:
                serialized_record = {}
                for key, value in record.items():
                    if isinstance(value, (timedelta, datetime)):
                        serialized_record[key] = serialize_timedelta(value)
                    else:
                        serialized_record[key] = value
                serialized.append(serialized_record)
            return serialized

        # Fetch Instagram status
        if platform in ['instagram', 'both']:
            query = """
                SELECT id, user_id, username, email, sch_start_range, sch_end_range, 
                       number_of_posts, posts_left, next_post_time 
                FROM instagram WHERE posts_left > 0
            """
            params = []
            if user_id:
                query += " AND user_id = %s"
                params.append(user_id)
            cursor.execute(query, params)
            instagram_records = cursor.fetchall()
            result['instagram'] = serialize_records(instagram_records)
            result['instagram_count'] = len(instagram_records)  # Add row count

        # Fetch Telegram status
        if platform in ['telegram', 'both']:
            query = """
                SELECT id, user_id, channel_name, email, token_sesson, sch_start_range, 
                       sch_end_range, number_of_posts, posts_left, next_post_time 
                FROM telegram WHERE posts_left > 0
            """
            params = []
            if user_id:
                query += " AND user_id = %s"
                params.append(user_id)
            cursor.execute(query, params)
            telegram_records = cursor.fetchall()
            result['telegram'] = serialize_records(telegram_records)
            result['telegram_count'] = len(telegram_records)  # Add row count

        # Fetch Facebook status
        if platform in ['facebook', 'both']:
            query = """
                SELECT id, user_id, username, email, channel_name, sch_start_range, 
                       sch_end_range, number_of_posts, posts_left, next_post_time 
                FROM facebook WHERE posts_left > 0
            """
            params = []
            if user_id:
                query += " AND user_id = %s"
                params.append(user_id)
            cursor.execute(query, params)
            facebook_records = cursor.fetchall()
            result['facebook'] = serialize_records(facebook_records)
            result['facebook_count'] = len(facebook_records)  # Add row count

        # Fetch YouTube status
        if platform in ['youtube', 'both']:
            query = """
                SELECT id, user_id, username, email, sch_start_range, sch_end_range, 
                       number_of_posts, posts_left, next_post_time 
                FROM youtube WHERE posts_left > 0
            """
            params = []
            if user_id:
                query += " AND user_id = %s"
                params.append(user_id)
            cursor.execute(query, params)
            youtube_records = cursor.fetchall()
            result['youtube'] = serialize_records(youtube_records)
            result['youtube_count'] = len(youtube_records)  # Add row count

        cursor.close()
        conn.close()
        return jsonify(result), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/posts/add', methods=['POST'])
def add_posts():
    """Add posts to an existing platform record."""
    data = request.get_json()
    platform = data.get('platform')
    record_id = data.get('record_id')
    additional_posts = data.get('additional_posts')

    # Validation
    if platform not in ['instagram', 'telegram', 'facebook', 'youtube']:
        return jsonify({"error": "Invalid platform (use 'instagram', 'telegram', 'facebook', or 'youtube')"}), 400
    if not record_id or not isinstance(record_id, int):
        return jsonify({"error": "Valid record_id is required"}), 400
    if not additional_posts or not isinstance(additional_posts, int) or additional_posts <= 0:
        return jsonify({"error": "Additional posts must be a positive integer"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        table = platform
        # Verify record exists
        cursor.execute(f"SELECT id, number_of_posts, posts_left FROM {table} WHERE id = %s", (record_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            conn.close()
            return jsonify({"error": f"{platform.capitalize()} record not found"}), 400

        current_posts, current_posts_left = result[1], result[2]
        new_posts = current_posts + additional_posts
        new_posts_left = current_posts_left + additional_posts

        # Update posts
        query = f"""
            UPDATE {table} SET 
                number_of_posts = %s, 
                posts_left = %s, 
                selected = 'No', 
                done = 'No', 
                next_post_time = NULL 
            WHERE id = %s
        """
        cursor.execute(query, (new_posts, new_posts_left, record_id))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": f"Added {additional_posts} posts to {platform} record"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/admin/export', methods=['GET'])
def export_data():
    """Export user and platform data to JSON."""
    email = request.args.get('email')

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        result = {}

        # Fetch user_id if email provided
        user_id = None
        if email:
            user_id = get_user_id_from_email(email)
            if not user_id:
                cursor.close()
                conn.close()
                return jsonify({"error": "User not available for the provided email"}), 400

        # Helper function to serialize records
        def serialize_records(records):
            serialized = []
            for record in records:
                serialized_record = {}
                for key, value in record.items():
                    if isinstance(value, (timedelta, datetime)):
                        serialized_record[key] = serialize_timedelta(value)
                    else:
                        serialized_record[key] = value
                serialized.append(serialized_record)
            return serialized

        # Fetch users
        query = "SELECT Id, Name, email, expiry FROM user"
        if user_id:
            query += " WHERE Id = %s"
            cursor.execute(query, (user_id,))
        else:
            cursor.execute(query)
        result['users'] = serialize_records(cursor.fetchall())

        # Fetch Instagram accounts
        query = "SELECT id, user_id, username, email, sch_start_range, sch_end_range, number_of_posts, posts_left, next_post_time FROM instagram"
        if user_id:
            query += " WHERE user_id = %s"
            cursor.execute(query, (user_id,))
        else:
            cursor.execute(query)
        result['instagram'] = serialize_records(cursor.fetchall())

        # Fetch Telegram channels
        query = "SELECT id, user_id, channel_name, email, sch_start_range, sch_end_range, number_of_posts, posts_left, next_post_time FROM telegram"
        if user_id:
            query += " WHERE user_id = %s"
            cursor.execute(query, (user_id,))
        else:
            cursor.execute(query)
        result['telegram'] = serialize_records(cursor.fetchall())

        # Fetch Facebook pages
        query = "SELECT id, user_id, username, email, channel_name, sch_start_range, sch_end_range, number_of_posts, posts_left, next_post_time FROM facebook"
        if user_id:
            query += " WHERE user_id = %s"
            cursor.execute(query, (user_id,))
        else:
            cursor.execute(query)
        result['facebook'] = serialize_records(cursor.fetchall())

        # Fetch YouTube channels
        query = "SELECT id, user_id, username, email, sch_start_range, sch_end_range, number_of_posts, posts_left, next_post_time FROM youtube"
        if user_id:
            query += " WHERE user_id = %s"
            cursor.execute(query, (user_id,))
        else:
            cursor.execute(query)
        result['youtube'] = serialize_records(cursor.fetchall())

        cursor.close()
        conn.close()
        return jsonify(result), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/instagram', methods=['POST'])
def add_instagram():
    """Add or update an Instagram account for a user, including Google Drive link."""
    data = request.get_json()
    email = data.get('email')
    username = data.get('username')
    password = data.get('password') or data.get('passwand')  # Accept both
    token_sesson = data.get('token_sesson')  # Get the token from request
    google_drive_link = data.get('google_drive_link')
    sch_start_range = data.get('sch_start_range', '20:00:00')
    sch_end_range = data.get('sch_end_range', '17:00:00')
    number_of_posts = data.get('number_of_posts', 0)

    # Validation
    if not email or not validate_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
    if not password:
        return jsonify({"error": "Password is required"}), 400
    start_td = time_to_timedelta(sch_start_range)
    end_td = time_to_timedelta(sch_end_range)
    if not start_td or not end_td:
        return jsonify({"error": "Invalid time format for sch_start_range or sch_end_range (use HH:MM:SS)"}), 400
    if number_of_posts < 0:
        return jsonify({"error": "Number of posts must be non-negative"}), 400

    # Fetch user_id from email
    user_id = get_user_id_from_email(email)
    if not user_id:
        return jsonify({"error": "User not available for the provided email"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Check if Instagram account exists for user
        cursor.execute("SELECT id FROM instagram WHERE user_id = %s AND username = %s", (user_id, username))
        existing = cursor.fetchone()

        if existing:
            # Update existing record
            query = """
                UPDATE instagram SET 
                    passwand = %s, 
                    email = %s,
                    token_sesson = %s,
                    token_drive = %s,
                    google_drive_link = %s, 
                    sch_start_range = %s, 
                    sch_end_range = %s, 
                    number_of_posts = %s, 
                    posts_left = %s, 
                    selected = 'No', 
                    done = 'No', 
                    schedule_type = 'range', 
                    next_post_time = NULL 
                WHERE id = %s
            """
            cursor.execute(query, (password, email, token_sesson, token_sesson, google_drive_link, sch_start_range, sch_end_range, number_of_posts, number_of_posts, existing[0]))
            record_id = existing[0]
            action = "updated"
        else:
            # Insert new record - store token in both token_sesson and token_drive
            query = """
                INSERT INTO instagram (
                    user_id, username, passwand, email, token_sesson, token_drive, google_drive_link, 
                    sch_start_range, sch_end_range, sch_date, sch_time, 
                    number_of_posts, posts_left, selected, done, schedule_type
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'No', 'No', 'range')
            """
            sch_date = datetime.now(TIMEZONE).strftime('%Y-%m-%d')
            sch_time = '12:00:00'
            cursor.execute(query, (
                user_id, username, password, email, token_sesson, token_sesson, google_drive_link,
                sch_start_range, sch_end_range, sch_date, sch_time,
                number_of_posts, number_of_posts
            ))
            record_id = cursor.lastrowid
            action = "created"

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": f"Instagram account {action} successfully", "record_id": record_id}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

@app.route('/telegram', methods=['POST'])
def add_telegram():
    """Add or update a Telegram channel for a user."""
    data = request.get_json()
    email = data.get('email')
    channel_name = data.get('channel_name')
    token_sesson = data.get('token_sesson')
    sch_start_range = data.get('sch_start_range', '09:00:00')  # Default 9 AM
    sch_end_range = data.get('sch_end_range', '17:00:00')      # Default 5 PM
    number_of_posts = data.get('number_of_posts', 0)

    # Validation
    if not email or not validate_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if not channel_name or len(channel_name) < 3:
        return jsonify({"error": "Channel name must be at least 3 characters long"}), 400
    if not token_sesson or (not token_sesson.startswith('@') and not token_sesson.startswith('-')):
        return jsonify({"error": "Invalid token_sesson (must start with '@' or '-')"}), 400
    start_td = time_to_timedelta(sch_start_range)
    end_td = time_to_timedelta(sch_end_range)
    if not start_td or not end_td:
        return jsonify({"error": "Invalid time format for sch_start_range or sch_end_range (use HH:MM:SS)"}), 400
    if number_of_posts < 0:
        return jsonify({"error": "Number of posts must be non-negative"}), 400

    # Fetch user_id from email
    user_id = get_user_id_from_email(email)
    if not user_id:
        return jsonify({"error": "User not available for the provided email"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Check if Telegram channel exists for user
        cursor.execute("SELECT id FROM telegram WHERE user_id = %s AND channel_name = %s", (user_id, channel_name))
        existing = cursor.fetchone()

        if existing:
            # Update existing record
            query = """
                UPDATE telegram SET 
                    token_sesson = %s, 
                    email = %s,
                    google_drive_link = NULL, 
                    sch_start_range = %s, 
                    sch_end_range = %s, 
                    number_of_posts = %s, 
                    posts_left = %s, 
                    selected = 'No', 
                    done = 'No', 
                    schedule_type = 'range', 
                    next_post_time = NULL 
                WHERE id = %s
            """
            cursor.execute(query, (token_sesson, email, sch_start_range, sch_end_range, number_of_posts, number_of_posts, existing[0]))
            record_id = existing[0]
            action = "updated"
        else:
            # Insert new record
            query = """
                INSERT INTO telegram (
                    user_id, channel_name, token_sesson, email, google_drive_link, 
                    sch_start_range, sch_end_range, sch_date, sch_time, 
                    number_of_posts, posts_left, selected, done, schedule_type
                ) VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, 'No', 'No', 'range')
            """
            sch_date = datetime.now(TIMEZONE).strftime('%Y-%m-%d')
            sch_time = '12:00:00'
            cursor.execute(query, (
                user_id, channel_name, token_sesson, email,
                sch_start_range, sch_end_range, sch_date, sch_time,
                number_of_posts, number_of_posts
            ))
            record_id = cursor.lastrowid
            action = "created"

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": f"Telegram channel {action} successfully", "record_id": record_id}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500
 
@app.route('/facebook', methods=['POST'])
def add_facebook():
    """Add or update a Facebook page for a user."""
    data = request.get_json()
    email = data.get('email')
    username = data.get('username')
    passwand = data.get('passwand')
    channel_name = data.get('channel_name')
    token_sesson = data.get('token_sesson')
    sch_start_range = data.get('sch_start_range', '09:00:00')  # Default 9 AM
    sch_end_range = data.get('sch_end_range', '17:00:00')      # Default 5 PM
    number_of_posts = data.get('number_of_posts', 0)

    # Validation
    if not email or not validate_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
    if not passwand:
        return jsonify({"error": "Password is required"}), 400
    if not channel_name or len(channel_name) < 3:
        return jsonify({"error": "Channel name must be at least 3 characters long"}), 400
    if not token_sesson:
        return jsonify({"error": "Token session is required"}), 400
    start_td = time_to_timedelta(sch_start_range)
    end_td = time_to_timedelta(sch_end_range)
    if not start_td or not end_td:
        return jsonify({"error": "Invalid time format for sch_start_range or sch_end_range (use HH:MM:SS)"}), 400
    if number_of_posts < 0:
        return jsonify({"error": "Number of posts must be non-negative"}), 400

    # Fetch user_id from email
    user_id = get_user_id_from_email(email)
    if not user_id:
        return jsonify({"error": "User not available for the provided email"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Check if Facebook page exists for user
        cursor.execute("SELECT id FROM facebook WHERE user_id = %s AND channel_name = %s", (user_id, channel_name))
        existing = cursor.fetchone()

        if existing:
            # Update existing record
            query = """
                UPDATE facebook SET 
                    username = %s,
                    passwand = %s,
                    token_sesson = %s,
                    email = %s,
                    google_drive_link = NULL,
                    sch_start_range = %s,
                    sch_end_range = %s,
                    number_of_posts = %s,
                    posts_left = %s,
                    selected = 'No',
                    done = 'No',
                    schedule_type = 'range',
                    next_post_time = NULL
                WHERE id = %s
            """
            cursor.execute(query, (username, passwand, token_sesson, email, sch_start_range, sch_end_range, number_of_posts, number_of_posts, existing[0]))
            record_id = existing[0]
            action = "updated"
        else:
            # Insert new record
            query = """
                INSERT INTO facebook (
                    user_id, username, passwand, email, channel_name, token_sesson, google_drive_link,
                    sch_start_range, sch_end_range, sch_date, sch_time,
                    number_of_posts, posts_left, selected, done, schedule_type
                ) VALUES (%s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, 'No', 'No', 'range')
            """
            sch_date = datetime.now(TIMEZONE).strftime('%Y-%m-%d')
            sch_time = '12:00:00'
            cursor.execute(query, (
                user_id, username, passwand, email, channel_name, token_sesson,
                sch_start_range, sch_end_range, sch_date, sch_time,
                number_of_posts, number_of_posts
            ))
            record_id = cursor.lastrowid
            action = "created"

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": f"Facebook page {action} successfully", "record_id": record_id}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    
    
    
@app.route('/youtube', methods=['POST'])
def add_youtube():
    """Add or update a YouTube channel for a user using google_drive_link for Drive integration."""
    data = request.get_json()
    email = data.get('email')
    username = data.get('username')
    token_sesson = data.get('token_sesson', "{}")  # Default to empty JSON for session token
    channel_id = data.get('channel_id')
    google_drive_link = data.get('google_drive_link')  # Use database column name
    sch_start_range = data.get('sch_start_range', '09:00:00')
    sch_end_range = data.get('sch_end_range', '17:00:00')
    number_of_posts = data.get('number_of_posts', 0)

    # Validation
    if not email or not validate_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
    if not channel_id:
        return jsonify({"error": "Channel ID is required"}), 400
    start_td = time_to_timedelta(sch_start_range)
    end_td = time_to_timedelta(sch_end_range)
    if not start_td or not end_td:
        return jsonify({"error": "Invalid time format for sch_start_range or sch_end_range (use HH:MM:SS)"}), 400
    if number_of_posts < 0:
        return jsonify({"error": "Number of posts must be non-negative"}), 400

    # Fetch user_id from email
    user_id = get_user_id_from_email(email)
    if not user_id:
        return jsonify({"error": "User not available for the provided email"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Check if YouTube channel exists for user
        cursor.execute("SELECT id FROM youtube WHERE user_id = %s AND username = %s", (user_id, username))
        existing = cursor.fetchone()

        if existing:
            # Update existing record
            query = """
                UPDATE youtube SET 
                    token_sesson = %s,
                    email = %s,
                    channel_id = %s,
                    google_drive_link = %s,  -- Ensure this matches the database
                    sch_start_range = %s,
                    sch_end_range = %s,
                    number_of_posts = %s,
                    posts_left = %s,
                    selected = 'No',
                    done = 'No',
                    schedule_type = 'range',
                    next_post_time = NULL
                WHERE id = %s
            """
            cursor.execute(query, (
                token_sesson, email, channel_id, google_drive_link,
                sch_start_range, sch_end_range, number_of_posts, number_of_posts,
                existing[0]
            ))
            record_id = existing[0]
            action = "updated"
        else:
            # Insert new record
            query = """
                INSERT INTO youtube (
                    user_id, username, token_sesson, email, channel_id, google_drive_link,
                    sch_start_range, sch_end_range, sch_date, sch_time,
                    number_of_posts, posts_left, selected, done, schedule_type
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'No', 'No', 'range')
            """
            sch_date = datetime.now(TIMEZONE).strftime('%Y-%m-%d')
            sch_time = '12:00:00'
            cursor.execute(query, (
                user_id, username, token_sesson, email, channel_id, google_drive_link,
                sch_start_range, sch_end_range, sch_date, sch_time,
                number_of_posts, number_of_posts
            ))
            record_id = cursor.lastrowid
            action = "created"

        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": f"YouTube channel {action} successfully", "record_id": record_id}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500    
    
@app.route('/youtube/<int:record_id>', methods=['DELETE'])
def delete_youtube(record_id):
    """Delete a YouTube channel."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor()
        # Verify record exists
        cursor.execute("SELECT id FROM youtube WHERE id = %s", (record_id,))
        if not cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({"error": "YouTube record not found"}), 400

        cursor.execute("DELETE FROM youtube WHERE id = %s", (record_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({"message": "YouTube channel deleted successfully"}), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    
@app.route('/user/<int:user_id>', methods=['GET'])
def get_user(user_id):
    """Retrieve user details and associated Instagram/Telegram/Facebook/YouTube accounts."""
    if 'user_id' not in session or session['user_id'] != user_id:
        return jsonify({"error": "Unauthorized access"}), 403

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500

    try:
        cursor = conn.cursor(dictionary=True)
        # Fetch user details
        cursor.execute("SELECT Id, Name, email, expiry FROM user WHERE Id = %s", (user_id,))
        user = cursor.fetchone()
        if not user:
            cursor.close()
            conn.close()
            return jsonify({"error": "User ID does not exist"}), 400

        # Helper function to serialize ALL data types properly
        def serialize_records(records):
            serialized = []
            for record in records:
                serialized_record = {}
                for key, value in record.items():
                    # Handle time objects
                    if isinstance(value, timedelta):
                        total_seconds = int(value.total_seconds())
                        hours, remainder = divmod(total_seconds, 3600)
                        minutes, seconds = divmod(remainder, 60)
                        serialized_record[key] = f"{hours:02}:{minutes:02}:{seconds:02}"
                    # Handle datetime objects
                    elif isinstance(value, datetime):
                        serialized_record[key] = value.strftime('%Y-%m-%d %H:%M:%S')
                    # Handle time objects from database
                    elif hasattr(value, 'strftime') and not isinstance(value, (datetime, date)):
                        try:
                            serialized_record[key] = value.strftime('%H:%M:%S')
                        except:
                            serialized_record[key] = str(value)
                    # Handle None values
                    elif value is None:
                        serialized_record[key] = None
                    # Handle everything else
                    else:
                        serialized_record[key] = value
                serialized.append(serialized_record)
            return serialized

        # Fetch Instagram accounts - ADD ALL FIELDS including selected
        cursor.execute("""
            SELECT id, username, passwand, email, token_sesson, google_drive_link, 
                   selected, sch_start_range, sch_end_range, sch_date, sch_time,
                   number_of_posts, posts_left, done, schedule_type, next_post_time
            FROM instagram WHERE user_id = %s
        """, (user_id,))
        instagram_accounts = serialize_records(cursor.fetchall())

        # Fetch Telegram channels - ADD ALL FIELDS including selected
        cursor.execute("""
            SELECT id, channel_name, token_sesson, email, google_drive_link,
                   selected, sch_start_range, sch_end_range, sch_date, sch_time,
                   number_of_posts, posts_left, done, schedule_type, next_post_time
            FROM telegram WHERE user_id = %s
        """, (user_id,))
        telegram_channels = serialize_records(cursor.fetchall())

        # Fetch Facebook pages
        cursor.execute("""
            SELECT id, username, email, channel_name, sch_start_range, sch_end_range, 
                   number_of_posts, posts_left, selected
            FROM facebook WHERE user_id = %s
        """, (user_id,))
        facebook_pages = serialize_records(cursor.fetchall())

        # Fetch YouTube channels
        cursor.execute("""
            SELECT id, username, email, channel_id, google_drive_link, sch_start_range, 
                   sch_end_range, number_of_posts, posts_left, selected
            FROM youtube WHERE user_id = %s
        """, (user_id,))
        youtube_channels = serialize_records(cursor.fetchall())

        cursor.close()
        conn.close()
        
        return jsonify({
            "user": user,
            "instagram_accounts": instagram_accounts,
            "telegram_channels": telegram_channels,
            "facebook_pages": facebook_pages,
            "youtube_channels": youtube_channels
        }), 200
    except mysql.connector.Error as e:
        conn.close()
        return jsonify({"error": f"Database error: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True)