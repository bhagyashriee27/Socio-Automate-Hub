from flask import Flask, request, jsonify, session
import mysql.connector
import re
from datetime import datetime, timedelta
import pytz
import uuid
import os
from dotenv import load_dotenv

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
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    user_id = session['user_id']
    email_id = session['user_email']
    
    
    cursor.execute("SELECT COUNT(*) AS count FROM instagram WHERE user_id = %s AND selected = 'Yes'", (email_id,))
    instagram_active = cursor.fetchone()['count']
    cursor.execute("SELECT COUNT(*) AS count FROM telegram WHERE user_id = %s AND selected = 'Yes'", (email_id,))
    telegram_active = cursor.fetchone()['count']
    cursor.execute("SELECT COUNT(*) AS count FROM instagram WHERE user_id = %s", (email_id,))
    instagram_total = cursor.fetchone()['count']
    cursor.execute("SELECT COUNT(*) AS count FROM telegram WHERE user_id = %s", (email_id,))
    telegram_total = cursor.fetchone()['count']
    cursor.close()
    conn.close()
    return jsonify({
        "totalAccounts": instagram_total + telegram_total,
        "activeSchedules": instagram_active + telegram_active,
        "instagramAccounts": instagram_total,
        "telegramAccounts": telegram_total
    })

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
        query = "INSERT INTO user (Name, passward, email, expiry) VALUES (%s, %s, %s, %s)"
        cursor.execute(query, (name, password, email, expiry))
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
    """Add or update an Instagram account for a user."""
    data = request.get_json()
    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    sch_start_range = data.get('sch_start_range', '09:00:00')  # Default 9 AM
    sch_end_range = data.get('sch_end_range', '17:00:00')      # Default 5 PM
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
            cursor.execute(query, (password, email, sch_start_range, sch_end_range, number_of_posts, number_of_posts, existing[0]))
            record_id = existing[0]
            action = "updated"
        else:
            # Insert new record
            query = """
                INSERT INTO instagram (
                    user_id, username, passwand, email, token_sesson, google_drive_link, 
                    sch_start_range, sch_end_range, sch_date, sch_time, 
                    number_of_posts, posts_left, selected, done, schedule_type
                ) VALUES (%s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, 'No', 'No', 'range')
            """
            sch_date = datetime.now(TIMEZONE).strftime('%Y-%m-%d')
            sch_time = '12:00:00'
            cursor.execute(query, (
                user_id, username, password, email, '{}', 
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
    """Add or update a YouTube channel for a user."""
    data = request.get_json()
    email = data.get('email')
    username = data.get('username')
    token_sesson = data.get('token_sesson')
    sch_start_range = data.get('sch_start_range', '09:00:00')  # Default 9 AM
    sch_end_range = data.get('sch_end_range', '17:00:00')      # Default 5 PM
    number_of_posts = data.get('number_of_posts', 0)

    # Validation
    if not email or not validate_email(email):
        return jsonify({"error": "Valid email is required"}), 400
    if not username or len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters long"}), 400
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
        # Check if YouTube channel exists for user
        cursor.execute("SELECT id FROM youtube WHERE user_id = %s AND username = %s", (user_id, username))
        existing = cursor.fetchone()

        if existing:
            # Update existing record
            query = """
                UPDATE youtube SET 
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
                INSERT INTO youtube (
                    user_id, username, token_sesson, email, google_drive_link,
                    sch_start_range, sch_end_range, sch_date, sch_time,
                    number_of_posts, posts_left, selected, done, schedule_type
                ) VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, 'No', 'No', 'range')
            """
            sch_date = datetime.now(TIMEZONE).strftime('%Y-%m-%d')
            sch_time = '12:00:00'
            cursor.execute(query, (
                user_id, username, token_sesson, email,
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

        # Fetch Instagram accounts
        cursor.execute("SELECT id, username, email, sch_start_range, sch_end_range, number_of_posts, posts_left FROM instagram WHERE user_id = %s", (user_id,))
        instagram_accounts = serialize_records(cursor.fetchall())

        # Fetch Telegram channels
        cursor.execute("SELECT id, channel_name, email, token_sesson, sch_start_range, sch_end_range, number_of_posts, posts_left FROM telegram WHERE user_id = %s", (user_id,))
        telegram_channels = serialize_records(cursor.fetchall())

        # Fetch Facebook pages
        cursor.execute("SELECT id, username, email, channel_name, sch_start_range, sch_end_range, number_of_posts, posts_left FROM facebook WHERE user_id = %s", (user_id,))
        facebook_pages = serialize_records(cursor.fetchall())

        # Fetch YouTube channels
        cursor.execute("SELECT id, username, email, sch_start_range, sch_end_range, number_of_posts, posts_left FROM youtube WHERE user_id = %s", (user_id,))
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