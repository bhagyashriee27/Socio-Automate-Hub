import subprocess
import mysql.connector
from datetime import datetime, time, timedelta
import pytz
from time import sleep
import os
import hashlib

# --- Configuration ---
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

# --- Helper Functions ---
def get_db_connection():
    """Establish connection to the MySQL database."""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def timedelta_to_time(td):
    """Convert timedelta object from DB to a time object."""
    if td is None:
        return None
    total_seconds = int(td.total_seconds())
    return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)

def get_earliest_post_time(table):
    """Fetch the earliest next_post_time from the specified table."""
    conn = get_db_connection()
    if not conn:
        print(f"ERROR: Failed to connect to database when querying {table}.")
        return None
    cursor = conn.cursor()
    query = f"SELECT MIN(next_post_time) AS earliest_time FROM {table} WHERE selected = 'Yes' AND done = 'No' AND posts_left > 0 AND next_post_time IS NOT NULL"
    cursor.execute(query)
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    return result[0] if result and result[0] else None

def make_aware(dt):
    """Convert naive datetime to timezone-aware datetime."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return TIMEZONE.localize(dt)
    return dt

def get_schedule_hash(start_time, end_time, posts_left):
    """Generate a hash to detect schedule changes."""
    schedule_string = f"{start_time}_{end_time}_{posts_left}"
    return hashlib.md5(schedule_string.encode()).hexdigest()

def calculate_initial_schedule(now, start_time, end_time, posts_left):
    """
    Calculate the initial posting schedule for the day.
    Returns list of datetime objects for each post.
    """
    # Create datetime objects for start and end times today
    start_datetime = now.replace(hour=start_time.hour, minute=start_time.minute, second=0, microsecond=0)
    end_datetime = now.replace(hour=end_time.hour, minute=end_time.minute, second=0, microsecond=0)
    
    # If end time is before start time, assume it's next day
    if end_datetime <= start_datetime:
        end_datetime += timedelta(days=1)
    
    # If current time is after end time, schedule for next day
    if now > end_datetime:
        start_datetime += timedelta(days=1)
        end_datetime += timedelta(days=1)
    
    total_seconds = (end_datetime - start_datetime).total_seconds()
    
    if posts_left <= 0 or total_seconds <= 0:
        return []
    
    # Calculate equal intervals
    interval_seconds = total_seconds / posts_left
    
    # Generate all post times for the day
    post_times = []
    for i in range(posts_left):
        post_time = start_datetime + timedelta(seconds=interval_seconds * i)
        # Only include future posts
        if post_time > now:
            post_times.append(post_time)
    
    return post_times

# --- Main Logic ---
def run_scheduler_once():
    """
    Combined scheduler for Instagram and Telegram.
    Fixed next_post_time calculation to prevent time creep.
    """
    conn = get_db_connection()
    if not conn:
        print("ERROR: Failed to connect to database. Exiting.")
        return

    cursor = conn.cursor(dictionary=True)
    
    # Get the current time in the specified timezone ('Asia/Kolkata')
    now = datetime.now(TIMEZONE)
    current_time = now.time()
    
    print(f"\n--- Running Combined Scheduler at {now.strftime('%Y-%m-%d %H:%M:%S %Z')} ---")

    # Process both platforms
    platforms = ['instagram', 'telegram']
    
    for platform in platforms:
        print(f"\nProcessing platform: {platform}")
        
        # Reset done status for accounts with posts left
        cursor.execute(f"UPDATE {platform} SET done = 'No' WHERE posts_left > 0")
        
        # Get all active accounts for this platform
        cursor.execute(f"""
            SELECT id, sch_start_range, sch_end_range, posts_left, next_post_time, 
                   number_of_posts, schedule_hash 
            FROM {platform} WHERE posts_left > 0
        """)
        rows = cursor.fetchall()

        for row in rows:
            row_id = row['id']
            start_time = timedelta_to_time(row['sch_start_range'])
            end_time = timedelta_to_time(row['sch_end_range'])

            if not start_time or not end_time:
                print(f"  - ID {row_id}: Missing schedule range. Skipping.")
                continue

            # Check if current time is within schedule range
            if start_time <= current_time <= end_time and row['posts_left'] > 0:
                # Set as selected for posting
                cursor.execute(f"UPDATE {platform} SET selected = 'Yes' WHERE id = %s", (row_id,))
                print(f"  - ID {row_id}: Within schedule. Set 'selected' to 'Yes'.")

                # Convert next_post_time to timezone-aware for comparison
                next_post_time_aware = make_aware(row['next_post_time']) if row['next_post_time'] else None

                # Calculate current schedule hash to detect changes
                current_schedule_hash = get_schedule_hash(
                    row['sch_start_range'], 
                    row['sch_end_range'], 
                    row['posts_left']
                )

                # Check if we need to recalculate schedule
                should_recalculate = False
                
                # Condition 1: No next_post_time or it's in the past
                if not next_post_time_aware or next_post_time_aware <= now:
                    should_recalculate = True
                    reason = "no valid next_post_time"
                
                # Condition 2: Schedule has changed (posts_left or time range)
                elif row.get('schedule_hash') != current_schedule_hash:
                    should_recalculate = True
                    reason = "schedule configuration changed"
                
                # Condition 3: Next post is from a different day (carry-over from previous day)
                elif next_post_time_aware.date() != now.date():
                    should_recalculate = True
                    reason = "crossing day boundary"

                if should_recalculate:
                    print(f"    -> Recalculating schedule: {reason}")
                    
                    # Calculate all post times for today
                    post_times = calculate_initial_schedule(now, start_time, end_time, row['posts_left'])
                    
                    if post_times:
                        # Set the first future post time
                        next_post = post_times[0]
                        cursor.execute(f"""
                            UPDATE {platform} SET 
                                next_post_time = %s, 
                                schedule_hash = %s 
                            WHERE id = %s
                        """, (next_post, current_schedule_hash, row_id))
                        print(f"    -> New next post: {next_post.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                    else:
                        # No posts can be scheduled today
                        cursor.execute(f"""
                            UPDATE {platform} SET 
                                selected = 'No', 
                                next_post_time = NULL,
                                schedule_hash = %s
                            WHERE id = %s
                        """, (current_schedule_hash, row_id))
                        print(f"    -> No posts can be scheduled today")
                else:
                    # next_post_time already exists and is valid
                    print(f"    -> Using existing schedule: {next_post_time_aware.strftime('%Y-%m-%d %H:%M:%S %Z')}")
            else:
                # Outside schedule range - clear schedule but keep hash
                current_schedule_hash = get_schedule_hash(
                    row['sch_start_range'], 
                    row['sch_end_range'], 
                    row['posts_left']
                )
                cursor.execute(f"""
                    UPDATE {platform} SET 
                        selected = 'No', 
                        next_post_time = NULL,
                        schedule_hash = %s
                    WHERE id = %s
                """, (current_schedule_hash, row_id))
                if row['posts_left'] > 0:
                    print(f"  - ID {row_id}: Outside schedule range. Set 'selected' to 'No'.")

    # Commit all changes
    conn.commit()
    cursor.close()
    conn.close()
    print("\n--- Combined scheduler run complete ---\n")
    sleep(3)

    # Check for scheduled posts and trigger appropriate workers
    instagram_time = get_earliest_post_time('instagram')
    telegram_time = get_earliest_post_time('telegram')

    print("Checking earliest post times:")
    print(f"  Instagram: {instagram_time.strftime('%Y-%m-%d %H:%M:%S %Z') if instagram_time else 'No scheduled posts'}")
    print(f"  Telegram: {telegram_time.strftime('%Y-%m-%d %H:%M:%S %Z') if telegram_time else 'No scheduled posts'}")

    # Determine which worker to run based on earliest post
    if not instagram_time and not telegram_time:
        print("No posts scheduled for either platform.")
        print("Starting both workers to check for immediate posts...")
        sleep(2)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_reel_loop.py")], check=False)
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_telegram.py")], check=False)
    else:
        # Convert to aware datetimes for comparison
        instagram_time_aware = make_aware(instagram_time) if instagram_time else None
        telegram_time_aware = make_aware(telegram_time) if telegram_time else None
        
        # Run the worker for the platform with the earliest post
        if instagram_time_aware and (not telegram_time_aware or instagram_time_aware <= telegram_time_aware):
            print("Running Instagram worker (earliest post)...")
            sleep(2)
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_reel_loop.py")], check=False)
        else:
            print("Running Telegram worker (earliest post)...")
            sleep(2)
            subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_telegram.py")], check=False)

if __name__ == "__main__":
    run_scheduler_once()