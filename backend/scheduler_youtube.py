import mysql.connector
from datetime import datetime, time, timedelta
import pytz
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database configuration
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
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"ERROR: Database connection failed: {str(e)}")
        return None

def timedelta_to_time(td):
    if td is None:
        return None
    total_seconds = int(td.total_seconds())
    return time(total_seconds // 3600, (total_seconds % 3600) // 60, total_seconds % 60)

def get_earliest_post_time():
    conn = get_db_connection()
    if not conn:
        return None
    cursor = conn.cursor()
    query = "SELECT MIN(next_post_time) AS earliest_time FROM youtube WHERE selected = 'Yes' AND done = 'No' AND posts_left > 0 AND next_post_time IS NOT NULL"
    cursor.execute(query)
    result = cursor.fetchone()
    cursor.close()
    conn.close()
    return result[0] if result and result[0] else None

def calculate_initial_schedule(now, start_time, end_time, posts_left):
    start_datetime = now.replace(hour=start_time.hour, minute=start_time.minute, second=0, microsecond=0)
    end_datetime = now.replace(hour=end_time.hour, minute=end_time.minute, second=0, microsecond=0)
    
    if end_datetime <= start_datetime:
        end_datetime += timedelta(days=1)
    
    if now > end_datetime:
        start_datetime += timedelta(days=1)
        end_datetime += timedelta(days=1)
    
    total_seconds = (end_datetime - start_datetime).total_seconds()
    
    if posts_left <= 0 or total_seconds <= 0:
        return []
    
    interval_seconds = total_seconds / posts_left
    post_times = []
    
    for i in range(posts_left):
        post_time = start_datetime + timedelta(seconds=interval_seconds * i)
        if post_time > now:
            post_times.append(post_time)
    
    return post_times

# --- Main Scheduler Logic ---
def run_scheduler_once():
    conn = get_db_connection()
    if not conn:
        print("ERROR: Failed to connect to database")
        return

    cursor = conn.cursor(dictionary=True)
    now = datetime.now(TIMEZONE)
    current_time = now.time()
    
    print(f"\n--- Running YouTube Scheduler at {now.strftime('%Y-%m-%d %H:%M:%S %Z')} ---")

    # Reset done status for channels with posts left
    cursor.execute("UPDATE youtube SET done = 'No' WHERE posts_left > 0")
    
    # Get all active YouTube channels
    cursor.execute("SELECT id, sch_start_range, sch_end_range, posts_left, next_post_time FROM youtube WHERE posts_left > 0")
    rows = cursor.fetchall()

    for row in rows:
        row_id = row['id']
        start_time = timedelta_to_time(row['sch_start_range'])
        end_time = timedelta_to_time(row['sch_end_range'])

        if not start_time or not end_time:
            print(f"  - ID {row_id}: Missing schedule range")
            continue

        if start_time <= current_time <= end_time and row['posts_left'] > 0:
            cursor.execute("UPDATE youtube SET selected = 'Yes' WHERE id = %s", (row_id,))
            print(f"  - ID {row_id}: Within schedule. Set 'selected' to 'Yes'")

            if not row['next_post_time'] or row['next_post_time'] <= now:
                post_times = calculate_initial_schedule(now, start_time, end_time, row['posts_left'])
                
                if post_times:
                    next_post = post_times[0]
                    cursor.execute("UPDATE youtube SET next_post_time = %s WHERE id = %s", (next_post, row_id))
                    print(f"    → Next upload: {next_post.strftime('%Y-%m-%d %H:%M:%S %Z')}")
                else:
                    cursor.execute("UPDATE youtube SET selected = 'No', next_post_time = NULL WHERE id = %s", (row_id,))
                    print(f"    → No uploads can be scheduled")
            else:
                print(f"    → Next upload already scheduled: {row['next_post_time'].strftime('%Y-%m-%d %H:%M:%S %Z')}")
        else:
            cursor.execute("UPDATE youtube SET selected = 'No', next_post_time = NULL WHERE id = %s", (row_id,))
            if row['posts_left'] > 0:
                print(f"  - ID {row_id}: Outside schedule range")

    conn.commit()
    cursor.close()
    conn.close()
    print("\n--- YouTube scheduler complete ---\n")

    # Check for scheduled posts
    youtube_time = get_earliest_post_time()
    print("Checking earliest upload time:")
    print(f"  YouTube: {youtube_time.strftime('%Y-%m-%d %H:%M:%S %Z') if youtube_time else 'No scheduled uploads'}")

    if youtube_time:
        print("Running YouTube uploader...")
        import subprocess
        subprocess.run(["python", os.path.join(os.path.dirname(__file__), "post_on_youtube.py")])

if __name__ == "__main__":
    run_scheduler_once()